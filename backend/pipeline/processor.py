import asyncio
import hashlib
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings
from ocr.siliconflow import call_ocr, split_into_blocks
from translate.base import translate_text
from cache.file_cache import (
    file_hash,
    text_hash,
    ocr_key,
    translate_key,
    read_cache,
    write_cache,
)

# 最大并发翻译请求数。SiliconFlow 免费额度对并发敏感，保守取 4。
MAX_CONCURRENCY = 4

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
    """
    按页缓存 OCR 结果。
    - 若第 0 页命中缓存且总页数已知，且所有页均命中 -> 完全跳过网络请求。
    - 否则重新 OCR，并把每一页（含总页数）写入缓存。
    """
    cache_dir = settings.cache_dir
    model = config.get("model", "")

    first = read_cache(cache_dir, ocr_key(pdf_hash, 0, model))
    total_pages = first.get("total_pages") if first else None

    if isinstance(total_pages, int) and total_pages > 0:
        pages: list = []
        for i in range(total_pages):
            c = read_cache(cache_dir, ocr_key(pdf_hash, i, model))
            if not c:
                pages = []
                break
            pages.append({"page": i, "blocks": c["blocks"]})
        if pages:
            job["stats"]["ocr_cache_hit"] = total_pages
            job["stats"]["ocr_total"] = total_pages
            return pages

    pages = await call_ocr(file_path, config)
    for p in pages:
        write_cache(
            cache_dir,
            ocr_key(pdf_hash, p["page"], model),
            {"total_pages": len(pages), "blocks": p["blocks"]},
        )
    job["stats"]["ocr_total"] = len(pages)
    return pages


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
        sem = asyncio.Semaphore(MAX_CONCURRENCY)

        # 提前挂载 pages：block 对象是引用，翻译过程中前端轮询即可渐进看到已完成的译文
        job["pages"] = pages

        async def _translate_one(block: dict, key: str):
            nonlocal done
            async with sem:
                translated = await translate_text(
                    block["original"], source_lang, target_lang, t_cfg
                )
                block["translated"] = translated
                write_cache(settings.cache_dir, key, {"translated": translated})
                done += 1
                job["progress"] = 30 + int(done / total * 70)

        try:
            await asyncio.gather(*[_translate_one(b, k) for _p, b, k in pending])
        except Exception:
            # 单个 block 失败不应让整本书前功尽弃：已完成的保留，失败的留空
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
