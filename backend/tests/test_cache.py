import tempfile

from cache.file_cache import (
    _cache_path,
    cache_stats,
    clear_cache,
    ocr_key,
    read_cache,
    translate_key,
    write_cache,
)


def test_miss_returns_none():
    d = tempfile.mkdtemp()
    assert read_cache(d, ocr_key("h", 1, "m")) is None


def test_roundtrip():
    d = tempfile.mkdtemp()
    k = ocr_key("h", 1, "m")
    write_cache(d, k, {"blocks": [1, 2]})
    assert read_cache(d, k) == {"blocks": [1, 2]}


def test_two_layers_independent():
    d = tempfile.mkdtemp()
    k1 = ocr_key("h", 1, "m")
    k2 = translate_key("原文", "en", "m")
    write_cache(d, k1, {"layer": "ocr"})
    write_cache(d, k2, {"layer": "tr"})
    assert read_cache(d, k1)["layer"] == "ocr"
    assert read_cache(d, k2)["layer"] == "tr"


def test_corrupt_file_returns_none():
    d = tempfile.mkdtemp()
    k = ocr_key("h", 1, "m")
    p = _cache_path(d, k)
    write_cache(d, k, {"ok": 1})
    with open(p, "w", encoding="utf-8") as f:
        f.write("{broken json")
    assert read_cache(d, k) is None


def test_clear_and_stats():
    d = tempfile.mkdtemp()
    write_cache(d, ocr_key("h", 1, "m"), {"a": 1})
    write_cache(d, translate_key("x", "en", "m"), {"b": 2})
    assert cache_stats(d)["entries"] == 2
    assert clear_cache(d) == 2
    assert cache_stats(d)["entries"] == 0
