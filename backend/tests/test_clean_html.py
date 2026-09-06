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
