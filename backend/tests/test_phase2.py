"""阶段2 翻译质量工程单元测试：sanitize / finish_reason 减半重试 / 跨页合并 / 缓存版本。"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from cache.file_cache import translate_key
from pipeline.processor import _merge_cross_page, _single_block
from translate.providers.openai_compat import (
    PROMPT_VERSION,
    OpenAICompatProvider,
    parse_segments,
)
from translate.sanitize import is_formula_block, protect_formulas, protect_math


# ── sanitize.protect_math ────────────────────────────────────────────


def test_protect_math_roundtrip():
    src = "The cost is \\(O(ND)\\) and display:\n\\[E = mc^2\\]\ndone."
    protected, restore = protect_math(src)
    assert "O(ND)" not in protected
    assert "[[M0]]" in protected and "[[M1]]" in protected
    assert restore(protected) == src


def test_protect_math_survives_translation_around_placeholder():
    src = "Use \\(x_1\\) here."
    protected, restore = protect_math(src)
    assert restore(f"使用 [[M0]] 此处。") == "使用 \\(x_1\\) 此处。"


def test_protect_math_no_math_is_noop():
    src = "plain text without math"
    protected, restore = protect_math(src)
    assert protected == src
    assert restore("译文") == "译文"


# ── sanitize.is_formula_block（v2：只跳过纯公式块）──────────────────


def test_pure_equation_block_detected():
    # 独立成段的展示公式：几乎没有可读单词、噪声密集
    eq = (
        "E_D-1 = {e_D-1 1, e_D-1 2, ..., e_D-1 N_D-1 }, "
        "P_D = {p_D 1, p_D 2, ...}, R_D-1 = {r_D-1 1, ...}"
    )
    assert is_formula_block(eq) is True


def test_mixed_prose_formula_block_not_skipped():
    # 用户截图实测块：公式碎片 + 真实论述 → 必须送翻（v1 整块跳过曾丢正文）
    frag = (
        "top- N topic entities E_0^0 = {e_1^0, e_2^0, ..., e_N^0}, to the question."
        "Note that the number of topic entities might possibly be less than N."
    )
    assert is_formula_block(frag) is False


def test_formula_fragment_block_detected():
    # 真实样例（TOG p2）：碎片为主、可读单词极少 → 纯公式块
    frag = "_E_⁰ = _{e_ 1⁰_, e_⁰ 2_, ..., e_⁰ _N__}_"
    assert is_formula_block(frag) is True


def test_normal_paragraph_not_detected():
    para = (
        "Graph-based retrieval augmented generation has attracted increasing "
        "attention. We evaluate our method on five benchmarks and report "
        "results in Table 1."
    )
    assert is_formula_block(para) is False


def test_paragraph_with_identifier_not_detected():
    para = (
        "We set the learning rate to 0.001 and use the adam_optimizer "
        "with batch_size of 32 for all experiments described below."
    )
    assert is_formula_block(para) is False


def test_short_text_never_formula():
    assert is_formula_block("_E_⁰") is False


# ── sanitize.protect_formulas（片段级保护）──────────────────────────


def test_protect_formulas_tokens():
    src = (
        "top- N topic entities E_0^0 = {e_1^0, e_2^0, ...} to the question. "
        "Note that the number might be less than N."
    )
    protected, restore = protect_formulas(src)
    assert "E_0^0" not in protected
    assert "[[F" in protected
    # 正文可读单词仍在（会被翻译）
    assert "question" in protected
    restored = restore("给定 [[F0]] 与 [[F1]]，注意数量。")
    assert "E_0^0" in restored and "{e_1^0" in restored


def test_protect_formulas_keeps_plain_words():
    src = "The adam_optimizer with batch_size of 32 works well."
    protected, restore = protect_formulas(src)
    # 含下划线的标识符被保护，普通单词不保护
    assert "[[F0]]" in protected and "[[F1]]" in protected
    assert "The" in protected and "works" in protected
    translated = "我们使用 [[F0]] 与 32 的 [[F1]]，效果很好。"
    assert restore(translated) == "我们使用 adam_optimizer 与 32 的 batch_size，效果很好。"


# ── openai_compat.parse_segments ─────────────────────────────────────


def test_parse_segments_full():
    out = "<<<0>>>\n你好\n<<<1>>>\n世界\n<<<2>>>\n结束"
    parsed = parse_segments(out, 3)
    assert parsed == {0: "你好", 1: "世界", 2: "结束"}


def test_parse_segments_prefix_fallback():
    # 模型没回显 <<<0>>> 标记时，前缀当作第 0 段
    parsed = parse_segments("你好\n<<<1>>>\n世界", 2)
    assert parsed[0] == "你好"
    assert parsed[1] == "世界"


# ── finish_reason=length → 减半重试（阶段2-T1）───────────────────────


def _fake_resp(content, finish_reason="stop"):
    class _R:
        status_code = 200
        text = ""

        def json(self):
            return {"choices": [{"message": {"content": content}, "finish_reason": finish_reason}]}

    return _R()


CFG = {"provider": "siliconflow", "api_key": "k", "api_url": "https://x/v1", "model": "m"}


def test_length_truncation_raises():
    p = OpenAICompatProvider()
    with patch(
        "translate.providers.openai_compat.httpx.AsyncClient.post",
        new=AsyncMock(return_value=_fake_resp("被截断的一半", "length")),
    ):
        with pytest.raises(RuntimeError, match="截断"):
            asyncio.run(p.translate("hello", "en", "zh", CFG))


def test_batch_halves_on_truncation():
    """合并请求截断 → 减半重试后单段成功，段数完整。"""
    p = OpenAICompatProvider()
    calls = {"n": 0}

    async def _post(*args, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return _fake_resp("只有一半 <<<0>>>\n第一段", "length")  # 批次截断
        # 减半后的单段请求逐个成功
        return _fake_resp(f"译{calls['n']}", "stop")

    async def _run():
        with patch(
            "translate.providers.openai_compat.httpx.AsyncClient.post",
            new=AsyncMock(side_effect=_post),
        ):
            return await p.translate_batch(["a", "b"], "en", "zh", CFG)

    outs = asyncio.run(_run())
    assert len(outs) == 2
    assert calls["n"] >= 3  # 1 次批次截断 + 减半后的请求


# ── 缓存键版本化（阶段2-T2）──────────────────────────────────────────


def test_translate_key_prompt_version_changes_key():
    h = "abc123"
    k1 = translate_key(h, "zh", "model-a")
    k2 = translate_key(h, "zh", "model-a", PROMPT_VERSION)
    assert k1 != k2  # 升版本后旧缓存自然失效


# ── 跨页段落合并（阶段2-T3）──────────────────────────────────────────


def _page(page, blocks):
    return {"page": page, "blocks": list(blocks)}


def _blk(page, text):
    b = _single_block(page, text)
    return b


def test_merge_continuation_across_pages():
    pages = [
        _page(0, [_blk(0, "A complete paragraph ends here."),
                  _blk(0, "This method achieves strong performance")]),
        _page(1, [_blk(1, "on all five benchmarks that we evaluate.")]),
    ]
    out = _merge_cross_page(pages)
    assert len(out[0]["blocks"]) == 2
    assert out[0]["blocks"][-1]["original"].endswith("that we evaluate.")
    assert len(out[1]["blocks"]) == 0


def test_no_merge_when_sentence_complete():
    pages = [
        _page(0, [_blk(0, "The experiment is complete.")]),
        _page(1, [_blk(1, "Next section starts here.")]),
    ]
    out = _merge_cross_page(pages)
    assert out[0]["blocks"][-1]["original"] == "The experiment is complete."
    assert len(out[1]["blocks"]) == 1


def test_no_merge_into_structural_block():
    pages = [
        _page(0, [_blk(0, "results are summarized in the following figure")]),
        _page(1, [_blk(1, "## Section 2\nSome heading content.")]),
    ]
    out = _merge_cross_page(pages)
    assert len(out[1]["blocks"]) == 1


def test_no_merge_for_image_blocks():
    pages = [
        _page(0, [_blk(0, "![Figure](cache/images/abc/fig_p001_00.png)")]),
        _page(1, [_blk(1, "continued text without terminator")]),
    ]
    out = _merge_cross_page(pages)
    assert len(out[0]["blocks"]) == 1 and len(out[1]["blocks"]) == 1


def test_hyphenated_word_joined():
    pages = [
        _page(0, [_blk(0, "the representa-")]),
        _page(1, [_blk(1, "tion power of graphs")]),
    ]
    out = _merge_cross_page(pages)
    assert out[0]["blocks"][-1]["original"] == "the representation power of graphs"


# ── 页眉/页脚固定文案过滤（跨页合并误吸页脚的根治）──────────────────


def test_conference_footer_dropped():
    from ocr.siliconflow import split_into_blocks
    text = (
        "Given a question, ToG leverages the underlying LLM to localize\n"
        "the initial entity of the reasoning paths.\n\n"
        "Published as a conference paper at ICLR 2024"
    )
    blocks = split_into_blocks(text)
    assert len(blocks) == 1
    assert "ICLR" not in blocks[0]


def test_body_text_mentioning_footers_kept():
    from ocr.siliconflow import split_into_blocks
    para = (
        "All baselines were published as a conference paper at ICLR 2024 or "
        "later, and we compare against them on five benchmarks with full "
        "reproduction of their reported settings and hyperparameters."
    )
    blocks = split_into_blocks(para)
    assert len(blocks) == 1  # 长正文不受页脚过滤影响


# ── 页眉/页脚固定文案过滤（跨页合并误吸页脚的根治）──────────────────


def test_conference_footer_dropped():
    from ocr.siliconflow import split_into_blocks
    text = (
        "Given a question, ToG leverages the underlying LLM to localize\n"
        "the initial entity of the reasoning paths.\n\n"
        "Published as a conference paper at ICLR 2024"
    )
    blocks = split_into_blocks(text)
    assert len(blocks) == 1
    assert "ICLR" not in blocks[0]


def test_body_text_mentioning_footers_kept():
    from ocr.siliconflow import split_into_blocks
    para = (
        "All baselines were published as a conference paper at ICLR 2024 or "
        "later, and we compare against them on five benchmarks with full "
        "reproduction of their reported settings and hyperparameters."
    )
    blocks = split_into_blocks(para)
    assert len(blocks) == 1  # 长正文不受页脚过滤影响
