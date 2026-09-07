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


# ── sanitize.strip_prompt_echo（提示词背景信息回声剥离，2026-09-07）──


def test_prompt_echo_title_stripped():
    """译文开头的「论文标题：<原题>」回声行被剥掉（DALK 实测形态）。"""
    from translate.sanitize import strip_prompt_echo

    title = "**DALK: Dynamic Co-Augmentation of LLMs and KG to answer Alzheimer's Disease Questions with Scientific Literature**"
    t = (
        "论文标题：DALK: Dynamic Co-Augmentation of LLMs and KG to answer "
        "Alzheimer's Disease Questions with Scientific Literature\n"
        "为了解决这些局限性，我们提出了"
    )
    out = strip_prompt_echo(t, title)
    assert out == "为了解决这些局限性，我们提出了"


def test_prompt_echo_keeps_real_title_translation():
    """标题块的正确翻译不能被误伤：内容与注入 doc_title 不一致就保留。"""
    from translate.sanitize import strip_prompt_echo

    title = "**DALK: Dynamic Co-Augmentation of LLMs and KG**"
    assert strip_prompt_echo("DALK：大语言模型与知识图谱的动态协同增强", title) == (
        "DALK：大语言模型与知识图谱的动态协同增强"
    )
    assert (
        strip_prompt_echo("论文标题：DALK：动态协同增强框架", title)
        == "论文标题：DALK：动态协同增强框架"
    )


def test_prompt_echo_glossary_stripped():
    """术语表标签行 + 连续条目被剥，正文保留。"""
    from translate.sanitize import strip_prompt_echo

    t = (
        "术语表（以下术语必须按给定译法翻译，全文保持一致）：\n"
        "- knowledge graph → 知识图谱\n"
        "- fine-tuning → 微调\n"
        "正文译文从这里开始"
    )
    assert strip_prompt_echo(t) == "正文译文从这里开始"


def test_prompt_echo_normal_text_untouched():
    from translate.sanitize import strip_prompt_echo

    t = "阿尔茨海默病（AD）是一种神经退行性疾病。"
    assert strip_prompt_echo(t, "**some title**") == t


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


# ── 全文续段合并升级（2026-09-07）：跳过结构性块找目标 ────────────────
# 旧版只看「前页末块+后页首块」，页末脚注会挡住真正被切断的段落
# （DALK 首页实测：脚注在页末，续文在中间或跨栏）。


def test_merge_skips_footnotes_to_find_target():
    pages = [
        _page(0, [
            _blk(0, "biomedical databases could supply rich sources of"),
            _blk(0, "> * Equal Constributions"),
            _blk(0, "> † Corresponding authors"),
            _blk(0, "AD knowledge, manual review of relevant information is impossible due to the large volume."),
        ]),
    ]
    out = _merge_cross_page(pages)
    assert len(out[0]["blocks"]) == 3
    assert out[0]["blocks"][0]["original"].endswith("the large volume.")
    # 脚注原样保留
    assert all(b["original"].startswith(">") for b in out[0]["blocks"][1:])


def test_merge_skips_page_boundary_and_heading():
    # 截断层后隔着脚注+翻页：目标在下一页
    pages = [
        _page(0, [
            _blk(0, "This efficiency issue would also limit"),
            _blk(0, "> * footnote"),
        ]),
        _page(1, [_blk(1, "the sizes of domain-specific LLMs, consequently affecting their performances.")]),
    ]
    out = _merge_cross_page(pages)
    assert out[0]["blocks"][0]["original"].endswith("affecting their performances.")
    assert len(out[0]["blocks"]) == 2 and len(out[1]["blocks"]) == 0


def test_no_merge_hyphen_into_uppercase():
    # 断词连字符只接小写连读（'informa-' + 'AD knowledge' 是重复残文，不能拼）
    pages = [
        _page(0, [_blk(0, "manual review of relevant informa-")]),
        _page(1, [_blk(1, "AD knowledge, manual review is impossible.")]),
    ]
    out = _merge_cross_page(pages)
    assert len(out[0]["blocks"]) == 1 and len(out[1]["blocks"]) == 1


def test_no_merge_nonfunction_tail_uppercase():
    # A 非虚词结尾 + 目标大写开头：不是续文（防误合并）
    pages = [
        _page(0, [_blk(0, "results on four public benchmarks")]),
        _page(1, [_blk(1, "Table 1 shows the comparison.")]),
    ]
    out = _merge_cross_page(pages)
    assert len(out[0]["blocks"]) == 1 and len(out[1]["blocks"]) == 1


def test_chain_merge_until_terminal():
    # A 合并后仍未完结 → 继续向后合并（连环续段）；中间图表标题块透明越过
    pages = [
        _page(0, [
            _blk(0, "the method relies on two"),
            _blk(0, "Figure 2: overall framework."),
        ]),
        _page(1, [
            _blk(1, "key components: retrieval and"),
            _blk(1, "ranking."),
        ]),
    ]
    out = _merge_cross_page(pages)
    assert out[0]["blocks"][0]["original"] == "the method relies on two key components: retrieval and ranking."
    # 图表标题块原样保留
    assert out[0]["blocks"][1]["original"].startswith("Figure 2")


def test_merge_skips_caption_to_find_target():
    # 段落被图表打断（用户实测：大部分截断由图表块引起）：caption 属结构块，
    # 透明越过找到真正的续文
    pages = [
        _page(0, [
            _blk(0, "while the knowledge ranked behind is not very"),
            _blk(0, "Figure 3: performance comparison."),
            _blk(0, "useful, thus successfully validating our hypothesis."),
        ]),
    ]
    out = _merge_cross_page(pages)
    assert len(out[0]["blocks"]) == 2
    assert out[0]["blocks"][0]["original"].endswith("validating our hypothesis.")
    assert out[0]["blocks"][1]["original"].startswith("Figure 3")


def test_merge_stops_before_heading():
    # 章节标题 = 硬边界：残段绝不跨标题吸收下一节内容
    pages = [
        _page(0, [
            _blk(0, "this method still has some limitations"),
            _blk(0, "## Conclusion"),
            _blk(0, "In this paper, we proposed a novel framework."),
        ]),
    ]
    out = _merge_cross_page(pages)
    assert out[0]["blocks"][0]["original"] == "this method still has some limitations"
    assert len(out[0]["blocks"]) == 3


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


# ── ACM/期刊版式页眉页脚家具块过滤（Survey 实测，2026-09-07）──────────


def test_acm_journal_footer_filtered():
    from ocr.siliconflow import split_into_blocks
    text = (
        "GraphRAG retrieves structured knowledge from graphs.\n\n"
        "J. ACM, Vol. 37, No. 4, Article 111. Publication date: September 2024."
    )
    blocks = split_into_blocks(text)
    assert len(blocks) == 1
    assert "J. ACM" not in blocks[0]


def test_running_head_and_page_number_filtered():
    from ocr.siliconflow import split_into_blocks
    text = "Peng et al.\n\n111:2\n\nBody paragraph stays intact."
    blocks = split_into_blocks(text)
    assert blocks == ["Body paragraph stays intact."]


def test_reference_with_initials_et_al_kept():
    from ocr.siliconflow import split_into_blocks
    ref = "Smith J, et al."
    blocks = split_into_blocks(ref)
    assert blocks == [ref]  # 带逗号/缩写的引用条目不是页眉作者行，不得误杀


# ── 列表项跨页续段（Survey 实测：贡献列表段落跨页续写）────────────────


def test_merge_list_item_continuation():
    # A 是列表项且以虚词收尾：可作为合并源，续文次页小写开头
    pages = [
        _page(
            0,
            [
                _blk(
                    0,
                    "- We delineate downstream tasks, benchmarks and applications, discussing both",
                )
            ],
        ),
        _page(1, [_blk(1, "the progress and prospects of this field.")]),
    ]
    out = _merge_cross_page(pages)
    assert out[0]["blocks"][0]["original"] == (
        "- We delineate downstream tasks, benchmarks and applications, "
        "discussing both the progress and prospects of this field."
    )


# ── run-in 引导标题拆分（Survey 实测：术语定义段 _Lead._ 正文）────────


def test_run_in_italic_lead_split():
    from ocr.siliconflow import split_into_blocks
    text = (
        "_Graph-Enhanced Generation (G-Generation)._ The graph-enhanced "
        "generation phase involves synthesizing meaningful outputs."
    )
    blocks = split_into_blocks(text)
    assert blocks == [
        "_Graph-Enhanced Generation (G-Generation)._",
        "The graph-enhanced generation phase involves synthesizing meaningful outputs.",
    ]


def test_run_in_bold_lead_split():
    from ocr.siliconflow import split_into_blocks
    text = "**Organization.** The rest of the survey is organized as follows."
    blocks = split_into_blocks(text)
    assert blocks == [
        "**Organization.**",
        "The rest of the survey is organized as follows.",
    ]


def test_mid_sentence_emphasis_not_split():
    from ocr.siliconflow import split_into_blocks
    text = "This _is_ important because the results hold across all settings."
    blocks = split_into_blocks(text)
    assert blocks == [text]  # 句中强调无终结符，不拆


# ── 段融合检测（HippoRAG 实测：整批译文被塞进 <<<0>>> 标题段）──────────


def test_fused_translation_detected():
    from translate.sanitize import is_fused_translation
    assert is_fused_translation(
        "# **HippoRAG: Long-Term Memory for LLMs**",
        "# **HippoRAG：大型语言模型的长期记忆**\n\n## 摘要\n\n摘要全文译文。\n\n"
        "## 引言\n\n引言全文译文。\n\n## 方法\n\n方法全文译文。",
    )


def test_fused_translation_normal_not_flagged():
    from translate.sanitize import is_fused_translation
    assert not is_fused_translation("# **Title**", "# **标题**")
    # 多段源译文段落更多不算融合（列表/分段本来就多段）
    assert not is_fused_translation(
        "Para one.\n\nPara two.",
        "第一段。\n\n第二段。\n\n第三段。",
    )


def test_translate_chunk_fused_triggers_halving():
    from unittest.mock import patch

    from translate.providers.openai_compat import OpenAICompatProvider

    p = OpenAICompatProvider()

    async def fake_translate(text, src, tgt, cfg):
        if "<<<" in text:
            # 模拟段融合：标题段吞下整批译文，其余标记正常
            return (
                "<<<0>>>\n# 标题译\n\n## 摘要\n\n摘要全文。\n\n## 引言\n\n引言全文。\n"
                "<<<1>>>\n作者一行译"
            )
        return f"译[{text[:12]}]"

    with patch.object(p, "translate", side_effect=fake_translate):
        out = asyncio.run(
            p._translate_chunk(["# **Title**", "**Author**"], "en", "zh", {})
        )
    # 减半到单段后各自正确翻译，融合文本不落任何段
    assert out == ["译[# **Title**]", "译[**Author**]"]
