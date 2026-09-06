"""图表区域快照回归测试（用户反馈"图片原模原样显示"，2026-09-06）。

依赖仓库内测试样张 test_ocr/GraphRAG-Bench.pdf（LaTeX 导出、矢量图表 +
页码页眉），验证：
1. 矢量图表（matplotlib 导出，轴标签为真实文本）能被检测并截图落盘；
2. 快照引用按「图在上、caption 在下」锚定插回 markdown；
3. 表格区域（find_tables 命中）不被误快照（文本层已可完整提取）；
4. 页码噪音块（独立纯数字行）被 split_into_blocks 过滤。
"""

import os
import re
import tempfile

import pytest

from ocr.siliconflow import split_into_blocks
from ocr.textlayer import extract_pages

_PDF = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test_ocr",
    "GraphRAG-Bench.pdf",
)

pytestmark = pytest.mark.skipif(not os.path.isfile(_PDF), reason="缺测试样张 PDF")


_IMG_REF = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def test_figure_snapshots_extracted(tmp_path):
    """page9（1-based）有两个矢量图（Figure 2/3），应快照出 2 个 PNG 引用。"""
    pages = extract_pages(_PDF, page_nums=[8], image_dir=str(tmp_path))
    assert pages[0], "page9 应有有效文本层"
    refs = _IMG_REF.findall(pages[0])
    assert len(refs) == 2, f"期望 2 个图引用，实际 {len(refs)}"
    for p in refs:
        assert os.path.isfile(p), f"快照文件不存在: {p}"
        assert os.path.getsize(p) > 10_000, f"快照疑似空图: {p}"


def test_figure_inserted_above_caption():
    """快照应插在对应 Figure caption 之前（图在上、注在下）。"""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        pages = extract_pages(_PDF, page_nums=[8], image_dir=d)
    md = pages[0] or ""
    m_img = md.find("![")
    m_cap = md.find("Figure 2:")
    assert 0 <= m_img < m_cap, "图片引用应位于 Figure 2 caption 之前"


def test_table_page_snapshotted_as_figure():
    """表格也按快照处理（2026-09-06 用户决策：文本表格转 markdown 必错位）：
    page7（1-based）的两个表格应各产生一个快照（该样张表格无表注，
    快照按页尾追加兜底）。断言须在临时目录存活期内完成。"""
    with tempfile.TemporaryDirectory() as d:
        pages = extract_pages(_PDF, page_nums=[6], image_dir=d)
        md = pages[0] or ""
        refs = _IMG_REF.findall(md)
        assert len(refs) >= 2, f"两个表格应产生至少 2 个快照引用，实际 {len(refs)}"
        for p in refs:
            assert os.path.isfile(p), f"快照文件不存在: {p}"


def test_page_number_noise_filtered():
    """独立页码行（纯数字 / Page x of y）不应成为翻译块。"""
    blocks = split_into_blocks("Introduction\n2\nPage 3 of 12\nMethods")
    joined = "\n".join(blocks)
    assert "Introduction" in joined and "Methods" in joined
    assert not any(b.strip() in {"2", "Page 3 of 12"} for b in blocks)
