import asyncio
import hashlib
import os
import re
import sys
import time
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings
from ocr.siliconflow import call_ocr, split_into_blocks
from ocr.textlayer import extract_pages, count_pages, MIN_TEXT_CHARS
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
# v3：图片策略改为图表区域快照（矢量图/碎栅格统一截图插回），markdown 内容变化。
# v4：图表内部文字 redact 剔除（不再与快照图重复），markdown 内容变化。
# v5：表格也按快照处理（文本表格转 markdown 必错位，用户决策），markdown 变化。
# v6：快照按类型命名（tab_*/fig_*），sidecar 记录 kind 与源 PDF，markdown 变化。
# v7：修复快照目录未创建导致 save 全部静默失败（首跑新文件无图无快照，TOG 实测）。
TEXT_LAYER_MODEL = "text-layer-v7"

# 视觉 OCR 缓存版本后缀。v2：OCR 结果顶部插入整页快照（扫描页图片/表格可见），
# 旧缓存无快照需失效——会使扫描页重跑一次视觉 OCR（产生一次 API 调用）。
VISION_CACHE_SUFFIX = "@v2"


def _single_block(page: int, text: str) -> dict:
    return {
        "block_id": 0,
        "page": page,
        "original": text,
        "translated": "",
        "position": {"y_start": 0, "y_end": 0},
    }

_jobs: dict[str, dict] = {}

# ── job 生命周期（阶段1-T4）──────────────────────────────────────────
# 旧实现 _jobs 只增不减：每处理一份 PDF 就多一条含全部页面文本的记录，
# 长期运行必然内存泄漏。策略：容量上限 + TTL 淘汰，且只淘汰已完成的 job
#（运行中/轮询中的一律保留，前端 30 分钟轮询窗口内的任务绝不被淘汰）。
MAX_JOBS = 50
JOB_TTL_SECONDS = 2 * 60 * 60  # 完成后保留 2 小时，供前端/调试复查


def _evict_jobs() -> None:
    now = time.time()
    # TTL：超期且已完成
    expired = [
        jid
        for jid, j in _jobs.items()
        if j["status"] in ("done", "failed")
        and j.get("finished_at")
        and now - j["finished_at"] > JOB_TTL_SECONDS
    ]
    for jid in expired:
        del _jobs[jid]
    # 容量：超额时淘汰最旧已完成的
    if len(_jobs) > MAX_JOBS:
        finished = sorted(
            (jid for jid, j in _jobs.items() if j["status"] in ("done", "failed")),
            key=lambda jid: _jobs[jid].get("finished_at") or 0,
        )
        for jid in finished:
            if len(_jobs) <= MAX_JOBS:
                break
            del _jobs[jid]


async def run_pipeline(file_path: str) -> dict:
    """
    启动一次处理任务。
    - 同一文件（内容哈希 + mtime）重复提交时复用已有任务，避免重复扣费。
    - 返回 job_id，由前端轮询 get_pipeline_status 获取结果。
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    _evict_jobs()

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


# 纯图片块（图表快照插入产生的 ![Figure](path)）：
# 原文块=原图快照；译文块=译制图（原排版+图内文字译文，见 ocr/figtranslate.py）
_PURE_IMAGE = re.compile(r"^\s*!\[[^\]]*\]\([^)]+\)\s*$")
# 从图片引用中提取本地路径
_IMG_PATH = re.compile(r"^\s*!\[[^\]]*\]\(([^)]+)\)\s*$")

# 图表"译制图"开关（2026-09-06 用户决策：先取消，图表全部用原图）。
# figtranslate.py 实现保留，置 True 可重新启用（左右对照=左原图右译图）。
FIGURE_TRANSLATION_ENABLED = False


async def _translate_figure_block(original_md: str, file_path: str, t_cfg: dict) -> str | None:
    """对图表快照块生成译制图。失败返回 None（前端回退显示原图）。"""
    from ocr.figtranslate import translate_figure

    m = _IMG_PATH.match(original_md)
    if not m:
        return None
    png = m.group(1)
    sidecar = png + ".json"
    if not os.path.isfile(sidecar):
        return None
    try:
        zh = await translate_figure(sidecar, file_path, t_cfg)
        if zh and os.path.isfile(zh):
            return f"![Figure]({zh.replace(os.sep, '/')})"
    except Exception as e:
        print(f"[figure] 译制图生成失败（回退原图）: {e}")
    return None


async def _load_or_run_ocr(file_path: str, pdf_hash: str, config: dict, job: dict) -> list:
    """混合 OCR（修复"内容不全"）+ 页级流式挂载（阶段1-T5）：

    1. 文本层优先——电子版 PDF 直接完整提取，零 API 成本；
    2. **逐页提取、逐页挂载**：pymupdf4llm 单页约 0.5s（表格检测为主，
       线程并行实测无效——GIL），整篇 12 页约 6s。改为页级流式后
       首页约 1 秒即可见，后续页边提取边出现；
    3. 文本层缓存命中的页毫秒级直接挂载（重跑同一文件秒开）；
    4. 无文本层的扫描页先挂空占位（保持页序对齐），提取完成后统一走
       视觉 OCR（只调这些页），结果原地替换占位；
    5. 两类结果统一按页缓存（文本层用伪模型名，与视觉模型缓存隔离）。"""
    cache_dir = settings.cache_dir
    vision_model = config.get("model", "")

    # 页数探测（毫秒级）
    total_pages = await asyncio.to_thread(count_pages, file_path)
    job["stats"]["ocr_total"] = total_pages

    # 渐进挂载：job_pages 与最终结果同一列表，前端轮询即见逐页增长
    job_pages: list = []
    job["pages"] = job_pages
    job["progress"] = 8

    image_dir = os.path.join(cache_dir, "images", pdf_hash[:16])
    os.makedirs(image_dir, exist_ok=True)  # 图表快照的落盘目录（曾漏建致快照全灭）
    pages: list = [None] * total_pages
    vision_pages: list[int] = []

    for i in range(total_pages):
        # 文本层缓存命中 → 直接挂载
        cached = read_cache(cache_dir, ocr_key(pdf_hash, i, TEXT_LAYER_MODEL))
        if cached and cached.get("blocks"):
            pages[i] = {"page": i, "blocks": cached["blocks"]}
            job["stats"]["ocr_cache_hit"] += 1
        else:
            md = (await asyncio.to_thread(extract_pages, file_path, [i], image_dir))[0]
            if md:  # 有文本层
                blocks = [_single_block(i, md)]
                write_cache(
                    cache_dir, ocr_key(pdf_hash, i, TEXT_LAYER_MODEL), {"blocks": blocks}
                )
                pages[i] = {"page": i, "blocks": blocks}
            else:  # 无文本层 → 视觉路线（先查缓存，未命中挂占位保持页序）
                vcached = read_cache(
                    cache_dir, ocr_key(pdf_hash, i, vision_model + VISION_CACHE_SUFFIX)
                )
                if vcached and vcached.get("blocks"):
                    pages[i] = {"page": i, "blocks": vcached["blocks"]}
                    job["stats"]["ocr_cache_hit"] += 1
                else:
                    vision_pages.append(i)
                    pages[i] = {"page": i, "blocks": []}
        job_pages.append(pages[i])
        job["progress"] = 8 + int((i + 1) / total_pages * 22)

    # 扫描页走视觉 OCR（只调缺的页），结果原地替换占位。
    # page_image_dir：扫描页整页快照存盘并插入正文顶部（原模原样展示）。
    if vision_pages:
        vis = await call_ocr(
            file_path, config, only_pages=vision_pages, page_image_dir=image_dir
        )
        for p in vis:
            pages[p["page"]] = p
            job_pages[p["page"]] = p  # 占位时序即页序，索引对齐
            write_cache(
                cache_dir,
                ocr_key(pdf_hash, p["page"], vision_model + VISION_CACHE_SUFFIX),
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

        # 先收集所有需要翻译的 block（跳过空白、纯图片与已缓存的）
        pending: list[tuple] = []  # (page, block, cache_key)
        fig_jobs: list[tuple] = []  # (block, cache_key, Task)——译制图与文本块并发
        for page in pages:
            for block in page["blocks"]:
                original = (block.get("original") or "").strip()
                if not original:
                    block["translated"] = ""
                    continue
                if _PURE_IMAGE.match(original):
                    # 图表块：译文=原图（图表不做翻译）。
                    # 译制图功能默认关闭（FIGURE_TRANSLATION_ENABLED），开启时
                    # 走"译制图"管线并并发调度（串行 await 曾把进度堵在 30%）。
                    block["translated"] = original
                    if FIGURE_TRANSLATION_ENABLED:
                        key = translate_key(text_hash(original), target_lang, model)
                        cached = read_cache(settings.cache_dir, key)
                        if cached and cached.get("translated"):
                            block["translated"] = cached["translated"]
                            stats["tr_cache_hit"] += 1
                            stats["tr_total"] += 1
                        else:
                            stats["tr_total"] += 1
                            fig_jobs.append(
                                (
                                    block,
                                    key,
                                    asyncio.create_task(
                                        _translate_figure_block(
                                            original, file_path, t_cfg
                                        )
                                    ),
                                )
                            )
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

        # 译制图任务收尾：与文本翻译并发执行，文本翻完这里等它们落盘。
        # 任何一个失败只影响那一张图（block 停留在回退原图），不阻断。
        if fig_jobs:
            print(f"[figure] 等待 {len(fig_jobs)} 张译制图生成…")
            fig_outs = await asyncio.gather(
                *[t for _, _, t in fig_jobs], return_exceptions=True
            )
            for (block, key), out in zip(fig_jobs, fig_outs):
                if isinstance(out, str) and out:
                    block["translated"] = out
                    write_cache(settings.cache_dir, key, {"translated": out})
                elif isinstance(out, Exception):
                    print(f"[figure] 译制图任务失败（回退原图）: {out}")

        job["pages"] = pages
        job["status"] = "done"
        job["progress"] = 100
        job["finished_at"] = time.time()
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["progress"] = job.get("progress", 0)
        job["finished_at"] = time.time()


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
