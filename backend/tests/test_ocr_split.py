from ocr.siliconflow import split_into_blocks


def test_empty():
    assert split_into_blocks("") == []
    assert split_into_blocks("   \n  ") == []


def test_paragraphs_kept():
    md = "第一段内容。\n\n第二段内容。"
    out = split_into_blocks(md)
    assert "第一段内容。" in out
    assert "第二段内容。" in out
    assert len(out) == 2


def test_long_paragraph_split_by_sentence():
    # 构造 >300 字、含多个句末标点的长段，应被切成多句
    sent = "这是一句测试文本。"
    long = sent * 60  # 约 600 字
    out = split_into_blocks(long)
    assert len(out) >= 2
    # 单块不应远超 300 字阈值
    assert all(len(b) <= 320 for b in out)


def test_markdown_blocks_preserved():
    md = "# 标题\n\n- 项目一\n- 项目二\n\n正文段落。"
    out = split_into_blocks(md)
    joined = "\n".join(out)
    assert "# 标题" in joined
    assert "- 项目一" in joined
