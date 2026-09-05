import asyncio
import hashlib
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings
from ocr.siliconflow import call_ocr, split_into_blocks
from ocr.textlayer import extract_all, MIN_TEXT_CHARS
from translate.base import translate_batch, translate_text
from cache.file_cache import (
    file_hash,
    text_hash,
    ocr_key,
    translate_key,
    read_cache,
    write_cache,
)

# 最大并发翻译块组数（每组一次合并请求）。8 并发 × 10 段/组，
# 免费档实测可承载；失败自动逐条回退，不影响正确性。
MAX_CONCURRENCY = 8

# 文本层提取结果在 OCR 缓存中的伪模型名（与视觉模型缓存隔离）。
# v2：提取内容增加 HTML 清理（<br>/<sup>/注释），旧缓存含脏数据需失效。
TEXT_LAYER_MODEL = "text-layer-v2"


def _single_block(page: int, text: str) -> dict:
    return {
        "block_id": 0,
        "page": page,
        "original": text,
        "translated": "",
        "position": {"y_start": 0, "y_end": 0},
    }

_jobs: dict[str, dict] = {}


async def run_pipeline(file_path: str) -> dict:
    """
    启动一次处理任务。
    - 同一文件（内容哈希 + mtime）重复提交时复用已有任务，避免重复扣费。
    - 返回 job_id，由前端轮询 get_pipeline_status 获取结果。
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    pdf_hash = file_hash(file_path)
    job_id = f"{pdf_hash[:16]}_{int(os.path.getmtime(file_path))}"

    existing = _jobs.get(job_id)
    if existing:
        # 已完成或仍在跑，直接复用，不重复计费
        return {
            "job_id": job_id,
            "status": existing["status"],
            "progress": existing["progress"],
            "reused": True,
        }

    _jobs[job_id] = {
        "status": "running",
        "progress": 0,
        "pages": [],
        "error": None,
        "stats": {"ocr_cache_hit": 0, "ocr_total": 0, "tr_cache_hit": 0, "tr_total": 0},
    }

    asyncio.create_task(_process_pipeline(file_path, job_id, pdf_hash))

    return {"job_id": job_id, "status": "running", "progress": 0, "reused": False}


def _split_page(page: dict) -> dict:
    """将一页 OCR 结果（整页 markdown 单个 block）切成段/句级多个 block。"""
    src_blocks = page.get("blocks", [])
    full_text = src_blocks[0]["original"] if src_blocks else ""
    parts = split_into_blocks(full_text)
    blocks = [
        {
            "block_id": i,
            "page": page["page"],
            "original": p,
            "translated": "",
            "position": {"y_start": 0, "y_end": 0},
        }
        for i, p in enumerate(parts)
    ]
    return {"page": page["page"], "blocks": blocks}


async def _load_or_run_ocr(file_path: str, pdf_hash: str, config: dict, job: dict) -> list:
    """混合 OCR（修复"内容不全"）：
    1. 文本层优先——电子版 PDF 直接完整提取，零成本零时延；
    2. 仅无文本层的扫描页/图片页回退视觉 OCR（且只调这些页）；
    3. 两类结果统一按页缓存（文本层用伪模型名，与视觉模型缓存隔离）。"""
    cache_dir = settings.cache_dir
    vision_model = config.get("model", "")

    # 1) 文本层提取（纯 CPU，毫秒级）；图片导出到按文件哈希隔离的目录
    job["progress"] = 8
    image_dir = os.path.join(cache_dir, "images", pdf_hash[:16])
    layer = await asyncio.to_thread(extract_all, file_path, image_dir)
    total_pages = len(layer)
    job["stats"]["ocr_total"] = total_pages

    pages: list = [None] * total_pages
    vision_pages: list[int] = []

    for i, md in enumerate(layer):
        if md:  # 有文本层
            cached = read_cache(cache_dir, ocr_key(pdf_hash, i, TEXT_LAYER_MODEL))
            if cached and cached.get("blocks"):
                blocks = cached["blocks"]
                job["stats"]["ocr_cache_hit"] += 1
            else:
                blocks = [_single_block(i, md)]
                write_cache(
                    cache_dir,
                    ocr_key(pdf_hash, i, TEXT_LAYER_MODEL),
                    {"blocks": blocks},
                )
            pages[i] = {"page": i, "blocks": blocks}
        else:  # 无文本层 → 视觉路线
            cached = read_cache(cache_dir, ocr_key(pdf_hash, i, vision_model))
            if cached and cached.get("blocks"):
                pages[i] = {"page": i, "blocks": cached["blocks"]}
                job["stats"]["ocr_cache_hit"] += 1
            else:
                vision_pages.append(i)

    # 2) 扫描页走视觉 OCR（只调缺的页）
    if vision_pages:
        vis = await call_ocr(file_path, config, only_pages=vision_pages)
        for p in vis:
            pages[p["page"]] = p
            write_cache(
                cache_dir,
                ocr_key(pdf_hash, p["page"], vision_model),
                {"blocks": p["blocks"]},
            )

    result = [p for p in pages if p is not None]
    if not result:
        raise ValueError("PDF 未解析出任何页面内容")
    return result


async def _process_pipeline(file_path: str, job_id: str, pdf_hash: str):
    job = _jobs[job_id]
    stats = job["stats"]
    try:
        # 处理前刷新配置，使改 Key/模型后无需重启（R7）
        settings.refresh()

        # ---- 阶段 1：OCR（0% ~ 30%）----
        job["progress"] = 5
        pages = await _load_or_run_ocr(file_path, pdf_hash, settings.ocr_config, job)
        # 把每页「整块 markdown」切成段/句级 block（对照粒度，见决策），
        # 切块发生在 OCR 缓存读取之后，因此不动 OCR 缓存粒度。
        pages = [_split_page(p) for p in pages]
        job["progress"] = 30

        # ---- 阶段 2：翻译（30% ~ 100%）----
        t_cfg = settings.translate_config
        target_lang = t_cfg.get("target_language", "en")
        source_lang = t_cfg.get("source_language", "zh")
        model = t_cfg.get("model", "")

        # 先收集所有需要翻译的 block（跳过空白与已缓存的）
        pending: list[tuple] = []  # (page, block, cache_key)
        for page in pages:
            for block in page["blocks"]:
                original = (block.get("original") or "").strip()
                if not original:
                    block["translated"] = ""
                    continue
                key = translate_key(text_hash(original), target_lang, model)
                cached = read_cache(settings.cache_dir, key)
                if cached and cached.get("translated"):
                    block["translated"] = cached["translated"]
                    stats["tr_cache_hit"] += 1
                    stats["tr_total"] += 1
                else:
                    pending.append((page, block, key))
                    stats["tr_total"] += 1

        total = max(len(pending), 1)
        done = 0
        # 并发按「块组」计：每组一次合并请求（6 段），请求数约为逐条模式的 1/6
        sem = asyncio.Semaphore(MAX_CONCURRENCY)

        # 提前挂载 pages：block 对象是引用，翻译过程中前端轮询即可渐进看到已完成的译文
        job["pages"] = pages

        async def _translate_chunk(chunk: list[tuple]):
            nonlocal done
            async with sem:
                texts = [b["original"] for _, b, _ in chunk]
                try:
                    outs = await translate_batch(
                        texts, source_lang, target_lang, t_cfg
                    )
                    if len(outs) != len(texts):
                        raise ValueError(
                            f"译文数量不匹配: 期望 {len(texts)} 得到 {len(outs)}"
                        )
                except Exception:
                    # 批量失败：逐条回退，宁可慢不可丢
                    outs = []
                    for t in texts:
                        try:
                            outs.append(
                                await translate_text(
                                    t, source_lang, target_lang, t_cfg
                                )
                            )
                        except Exception as e:
                            print(f"[translate] 单段翻译失败: {e}")
                            outs.append("")
                for (_, block, key), translated in zip(chunk, outs):
                    block["translated"] = translated
                    write_cache(settings.cache_dir, key, {"translated": translated})
                    done += 1
                    job["progress"] = 30 + int(done / total * 70)

        chunks = [
            pending[i : i + 10] for i in range(0, len(pending), 10)
        ]

        try:
            await asyncio.gather(*[_translate_chunk(c) for c in chunks])
        except Exception:
            # 单个 chunk 失败不应让整本书前功尽弃：已完成的保留，失败的留空
            pass

        job["pages"] = pages
        job["status"] = "done"
        job["progress"] = 100
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["progress"] = job.get("progress", 0)


async def get_pipeline_status(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if not job:
        return {
            "job_id": job_id,
            "status": "unknown",
            "progress": 0,
            "pages": [],
            "error": None,
        }
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "pages": job.get("pages", []),
        "error": job.get("error"),
        "stats": job.get("stats"),
    }
