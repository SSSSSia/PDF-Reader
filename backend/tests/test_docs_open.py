"""阶段6-T3：open_cached_doc 缓存重建测试（不触网，纯缓存读写）。"""

import asyncio
import tempfile

from pipeline import processor
from pipeline.processor import TEXT_LAYER_MODEL, open_cached_doc
from cache.file_cache import ocr_key, translate_key, text_hash, write_cache
from translate.providers.openai_compat import PROMPT_VERSION


def _page_cache(page: int, blocks: list) -> dict:
    return {"blocks": blocks}


def _block(page: int, text: str, block_id: int = 0) -> dict:
    return {
        "block_id": block_id,
        "page": page,
        "original": text,
        "translated": "",
        "position": {"y_start": 0, "y_end": 0},
    }


def _setup_cache_dir(monkeypatch) -> str:
    d = tempfile.mkdtemp()
    monkeypatch.setattr(processor.settings, "cache_dir", d)
    monkeypatch.setattr(processor.settings, "ocr_config", {"model": "test-vision"})
    monkeypatch.setattr(
        processor.settings,
        "translate_config",
        {"target_language": "en", "model": "test-model"},
    )
    return d


def test_rebuild_fills_translations_from_cache(monkeypatch):
    d = _setup_cache_dir(monkeypatch)
    # 页 0：整页 markdown 单块（真实 OCR 缓存形态，_single_block 写入）
    write_cache(
        d,
        ocr_key("h" * 40, 0, TEXT_LAYER_MODEL),
        _page_cache(
            0,
            [
                _block(
                    0,
                    "# **DALK: Knowledge Agent**\n\nGraph neural networks help retrieval.",
                )
            ],
        ),
    )
    # 正文块的译文缓存（与管线同一 key 规则）
    write_cache(
        d,
        translate_key(text_hash("Graph neural networks help retrieval."), "en", "test-model", PROMPT_VERSION),
        {"translated": "图神经网络有助于检索。"},
    )

    out = asyncio.run(open_cached_doc("h" * 40, 1, ""))
    assert out["file_exists"] is False
    assert out["doc_title"] == "**DALK: Knowledge Agent**"
    blocks = out["pages"][0]["blocks"]
    # 页眉剔除后标题块仍在（带 # 前缀的是真标题，不被剔除）
    assert any("DALK" in b["original"] for b in blocks)
    body = next(b for b in blocks if "Graph neural" in b["original"])
    assert body["translated"] == "图神经网络有助于检索。"


def test_rebuild_raises_when_cache_all_missing(monkeypatch):
    _setup_cache_dir(monkeypatch)
    try:
        asyncio.run(open_cached_doc("h" * 40, 3, ""))
        assert False, "应当抛 ValueError"
    except ValueError as e:
        assert "重新翻译" in str(e)


def test_rebuild_keeps_page_order_on_partial_cache(monkeypatch):
    d = _setup_cache_dir(monkeypatch)
    write_cache(
        d,
        ocr_key("h" * 40, 1, TEXT_LAYER_MODEL),
        _page_cache(1, [_block(1, "Only page 1 cached.", 0)]),
    )
    out = asyncio.run(open_cached_doc("h" * 40, 3, ""))
    assert [p["page"] for p in out["pages"]] == [0, 1, 2]
    assert out["pages"][0]["blocks"] == []
    assert out["pages"][1]["blocks"]
