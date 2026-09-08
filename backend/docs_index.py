"""持久化文档索引（阶段6-T2，2026-09-08 用户需求：主页展示已翻译文章）。

管线 done 时 upsert 一条记录到数据目录（%APPDATA%/pdf-reader/）下的
docs_index.json；此前管线结果只存内存 _jobs（TTL 淘汰），重启后主页
无从展示。本模块只做索引层，不改动现有 KV 缓存结构（阶段 6 范围约束）。

- doc_id = pdf_hash 前 16 位（与 job_id 前缀、images/ 目录名一致）；
- file_mtime 记录翻译时的源文件 mtime：可重建 job_id（pdf_hash16_mtime），
  T3 重开文档时用于定位该次翻译会话；
- 原子写沿用 write_cache 的 tmp + os.replace 模式，防半截 JSON；
- 读取侧防御性容错：文件缺失/损坏一律返回空列表（索引可随时重建，
  丢索引只是丢主页列表，不影响任何缓存数据）。
"""

import json
import os
import tempfile
import time

INDEX_FILENAME = "docs_index.json"


def index_path(data_dir: str) -> str:
    return os.path.join(data_dir, INDEX_FILENAME)


def load_index(data_dir: str) -> list:
    """读取全部索引记录（新翻译的在前）。缺失/损坏返回空列表。"""
    path = index_path(data_dir)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def upsert_doc(data_dir: str, doc: dict) -> None:
    """按 doc_id upsert（新记录插队首，最近翻译排前），原子落盘。

    translated_at 缺省补当前本地时间；file_path 统一转绝对路径。
    """
    doc_id = (doc.get("doc_id") or "").strip()
    if not doc_id:
        return
    doc = {
        **doc,
        "doc_id": doc_id,
        "file_path": os.path.abspath(doc.get("file_path") or ""),
        "translated_at": doc.get("translated_at")
        or time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
    }
    docs = [d for d in load_index(data_dir) if d.get("doc_id") != doc_id]
    docs.insert(0, doc)
    _atomic_write(data_dir, docs)


def get_doc(data_dir: str, doc_id: str) -> dict | None:
    for d in load_index(data_dir):
        if d.get("doc_id") == doc_id:
            return d
    return None


def _atomic_write(data_dir: str, docs: list) -> None:
    os.makedirs(data_dir, exist_ok=True)
    path = index_path(data_dir)
    fd, tmp = tempfile.mkstemp(dir=data_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(docs, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
