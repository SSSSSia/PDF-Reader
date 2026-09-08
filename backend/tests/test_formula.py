"""公式识别模块单测：缓存键 / 合法性校验 / 缓存回填（不触发 API）。"""

from cache.file_cache import write_cache
from ocr.formula import (
    _valid_latex,
    formula_cache_key,
    load_cached_formula,
    wrap_bare_latex,
)


def test_wrap_bare_latex_wraps_macros_without_delimiters():
    """PaddleOCR-VL 实测从不输出 $ 定界：裸宏片段必须包裹才能 KaTeX 渲染。"""
    src = r"P(x|k) = N(x; \mu_k, \Sigma_k)"
    out = wrap_bare_latex(src)
    assert out == r"P(x|k) = N(x; $\mu_k$, $\Sigma_k$)"


def test_wrap_bare_latex_handles_subsup_braces():
    src = r"\sigma_{i}^{2} and \alpha^t"
    out = wrap_bare_latex(src)
    assert r"$\sigma_{i}^{2}$" in out
    assert r"$\alpha^t$" in out


def test_wrap_bare_latex_noop_when_delimited():
    src = "text with $x_1$ already delimited"
    assert wrap_bare_latex(src) == src


def test_wrap_bare_latex_noop_without_macros():
    src = "plain words with no latex commands at all"
    assert wrap_bare_latex(src) == src


def test_formula_cache_key_deterministic_and_sensitive():
    a = formula_cache_key("pdfhash", 3, [1.0, 2.0, 3.0, 4.0], "m1")
    assert a == formula_cache_key("pdfhash", 3, [1.0, 2.0, 3.0, 4.0], "m1")
    assert a != formula_cache_key("pdfhash", 4, [1.0, 2.0, 3.0, 4.0], "m1")
    assert a != formula_cache_key("pdfhash", 3, [1.1, 2.0, 3.0, 4.0], "m1")
    assert a != formula_cache_key("pdfhash", 3, [1.0, 2.0, 3.0, 4.0], "m2")


def test_valid_latex():
    assert _valid_latex("$$E = mc^2$$")
    assert _valid_latex("\\frac{a}{b}")
    assert _valid_latex("x = 1")
    assert not _valid_latex("")
    assert not _valid_latex("plain words only no math here at all")
    assert not _valid_latex("x" * 9000)


def test_load_cached_formula_roundtrip_and_miss(tmp_path):
    ocr = {"model": "PaddlePaddle/PaddleOCR-VL-1.5"}
    bbox = [10.0, 20.0, 30.0, 40.0]
    key = formula_cache_key("pdfhash", 0, bbox, ocr["model"])
    # 未写入 → miss（绝不触发 API）
    assert load_cached_formula("pdfhash", 0, bbox, ocr, str(tmp_path)) is None
    write_cache(str(tmp_path), key, {"latex": "$$E=mc^2$$"})
    assert (
        load_cached_formula("pdfhash", 0, bbox, ocr, str(tmp_path)) == "$$E=mc^2$$"
    )
    # 污染条目（无数学记号）→ 命中侧校验视为未命中
    write_cache(str(tmp_path), key, {"latex": "garbage text"})
    assert load_cached_formula("pdfhash", 0, bbox, ocr, str(tmp_path)) is None
