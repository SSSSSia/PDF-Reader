"""文本层直接提取（修复"OCR 内容不全"的核心）。

大量 PDF 是电子版（Word/LaTeX 导出），自带完整文本层——直接提取可拿到
100% 完整的文字与结构，零 API 成本、秒级完成，远优于视觉模型"看图识字"。
只有无文本层的扫描页/图片页才需要回退视觉 OCR（见 pipeline/processor.py）。

pymupdf4llm 基于 PyMuPDF，输出带标题/加粗/表格结构的 Markdown，
并可把页内嵌入图片导出为文件、在 Markdown 中保留引用（对标 Scholaread
的"图片随排版流展示"效果）。
"""
import os
import re

import pymupdf
import pymupdf4llm

# 文本层字符数低于该阈值视为"无有效文本层"（扫描页/纯图片页），回退视觉 OCR
MIN_TEXT_CHARS = 120

_IMG_REF = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_BR_TAG = re.compile(r"<br\s*/?>", re.IGNORECASE)
_SUP_TAG = re.compile(r"<sup>(.*?)</sup>", re.IGNORECASE | re.DOTALL)
_SUB_TAG = re.compile(r"<sub>(.*?)</sub>", re.IGNORECASE | re.DOTALL)

# 上/下标字符映射：把 <sup>12</sup> 转成 ¹²，语义不丢失且不再是裸 HTML
_SUP_MAP = str.maketrans("0123456789+-=()ni", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ")
_SUB_MAP = str.maketrans("0123456789+-=()n", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙ")


def _clean_html(md: str) -> str:
    """数据清理（实测问题：正文中残留 <br>/<sup> 等 HTML 杂质，
    react-markdown 不渲染原始 HTML，会原样露出）。
    - HTML 注释（pymupdf4llm 对隐藏文本会输出 <!-- -->）整段删除；
    - <br> 转空格（表格行内换新行会破坏表格结构，空格最安全）；
    - <sup>/<sub> 转对应 Unicode 上/下标字符；
    - 实体转义还原。"""
    md = _HTML_COMMENT.sub("", md)
    md = _BR_TAG.sub(" ", md)
    md = _SUP_TAG.sub(lambda m: m.group(1).translate(_SUP_MAP), md)
    md = _SUB_TAG.sub(lambda m: m.group(1).translate(_SUB_MAP), md)
    md = md.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return md


def _normalize_image_refs(md: str, image_dir: str) -> str:
    """把 pymupdf4llm 生成的图片引用规整为「正斜杠绝对路径」，
    前端据此构造资源 URL（Tauri convertFileSrc / 浏览器 file/raw 接口）。"""
    def repl(m: re.Match) -> str:
        alt, src = m.group(1), m.group(2)
        base = os.path.basename(src.replace("\\", "/"))
        path = os.path.join(image_dir, base)
        if os.path.isfile(path):
            return f"![{alt}]({path.replace(os.sep, '/')})"
        return m.group(0)

    return _IMG_REF.sub(repl, md)


def count_pages(file_path: str) -> int:
    """返回 PDF 页数（纯本地毫秒级）。"""
    doc = pymupdf.open(file_path)
    try:
        return len(doc)
    finally:
        doc.close()


def extract_pages(
    file_path: str, page_nums: list[int], image_dir: str | None = None
) -> list[str | None]:
    """提取指定页的文本层 Markdown（页级流式提取的基础，阶段1-T5）。

    page_nums 按序提取，返回等长列表；无有效文本层的页为 None。
    pymupdf4llm 的图片文件名含页号（{doc}-{page:04d}-{idx:02d}），
    逐页/分页调用不会互相覆盖。单页提取约 0.5s（表格检测为主），
    上层逐页调用即可实现「首页秒开、后续页渐进出现」。
    """
    doc = pymupdf.open(file_path)
    try:
        kwargs: dict = {"page_chunks": True, "pages": page_nums}
        if image_dir:
            os.makedirs(image_dir, exist_ok=True)
            kwargs.update(
                write_images=True, image_path=image_dir, image_format="png"
            )
        chunks = pymupdf4llm.to_markdown(doc, **kwargs)
        out: list[str | None] = []
        for c in chunks:
            md = (c.get("text") or "").strip()
            if md:
                md = _clean_html(md)
                if image_dir:
                    md = _normalize_image_refs(md, image_dir)
            out.append(md if len(md) >= MIN_TEXT_CHARS else None)
        return out
    finally:
        doc.close()


def extract_all(file_path: str, image_dir: str | None = None) -> list[str | None]:
    """提取全部页面的文本层 Markdown（兼容入口，内部走 extract_pages）。"""
    return extract_pages(file_path, list(range(count_pages(file_path))), image_dir)
