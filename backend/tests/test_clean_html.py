"""textlayer._clean_html 单元测试（阶段1，开发流程 §4.1）。

纯函数测试：验证 HTML 杂质清理规则（<br>/<sup>/<sub>/注释/实体），
不发起任何网络请求。运行：.venv/Scripts/python.exe -m pytest backend/tests/ -q
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from ocr.textlayer import _clean_html


def test_br_tag_to_space():
    assert _clean_html("第一行<br>第二行") == "第一行 第二行"
    assert _clean_html("a<br/>b<br />c") == "a b c"


def test_sup_tag_to_unicode_superscript():
    assert _clean_html("10<sup>12</sup>") == "10¹²"
    assert _clean_html("x<sup>n-1</sup>") == "xⁿ⁻¹"


def test_sub_tag_to_unicode_subscript():
    assert _clean_html("H<sub>2</sub>O") == "H₂O"
    assert _clean_html("a<sub>0</sub>") == "a₀"


def test_html_comment_removed():
    assert _clean_html("正文A<!-- 隐藏注释 -->正文B") == "正文A正文B"
    assert _clean_html("<!--\n多行\n注释\n-->可见") == "可见"


def test_entities_restored():
    assert _clean_html("a&nbsp;b") == "a b"
    assert _clean_html("A&amp;B") == "A&B"
    assert _clean_html("&lt;tag&gt;") == "<tag>"


def test_clean_text_untouched():
    text = "普通中文段落，with English words, 100% 不受影响。"
    assert _clean_html(text) == text


# ── 伪标题降级（2026-09-08 用户反馈"这两句不是标题"）────────────────────

from ocr.textlayer import _demote_sentence_headings


def test_question_heading_demoted():
    """GraphRAG-Bench 实测形态：研究问句被字号启发式判成一级标题。"""
    src = '# **_\u201cDoes graph augmentation truly enhance reasoning capabilities beyond simple retrieval?\u201d_**'
    out = _demote_sentence_headings(src)
    assert out.startswith("**") and not out.startswith("#")
    assert "Does graph augmentation" in out


def test_long_sentence_heading_demoted():
    """≥14 词的超长'标题'基本都是句子。"""
    src = "# **A very long emphasized sentence that keeps going and going with many words inside**"
    assert _demote_sentence_headings(src).startswith("**")


def test_real_headings_untouched():
    """真标题（短语/编号式）保留原样。"""
    assert _demote_sentence_headings("# **GraphRAG-Bench: Challenging Benchmarks**") == "# **GraphRAG-Bench: Challenging Benchmarks**"
    assert _demote_sentence_headings("## **1 Introduction**") == "## **1 Introduction**"
    assert _demote_sentence_headings("## **Abstract**") == "## **Abstract**"


def test_numbered_period_heading_kept():
    """编号+句号开头的真标题（'1. Introduction.'）不降级。"""
    src = "## 1. Introduction to methods used here extensively today"
    assert _demote_sentence_headings(src) == src


def test_short_period_heading_kept():
    """句号结尾但 <6 词的短语标题保留。"""
    src = "# Next Generation Systems."
    assert _demote_sentence_headings(src) == src


def test_chinese_question_heading_demoted():
    src = "# \u201c\u56fe\u589e\u5f3a\u771f\u7684\u80fd\u8d85\u8d8a\u7b80\u5355\u68c0\u7d22\u5417\uff1f\u201d"
    out = _demote_sentence_headings(src)
    assert out.startswith("**") and not out.startswith("#")
