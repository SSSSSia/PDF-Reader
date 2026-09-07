"""块级 bbox 标注（阶段5-T1，D6 立项「原版对照渲染」的数据基础）。

把流水线最终块（跨页合并后）通过文本前缀匹配映射回 PyMuPDF 原始块坐标，
供前端原版模式在 pdfjs 渲染的页面上按坐标叠加高亮/译文浮层。

设计要点（与阶段4 Spike 结论对齐）：
- 复用 ocr/textlayer.py 的 _md_norm/_match_block（与 _column_reading_order
  同一机制，含字母级回退——上/下标转换会让数字级匹配必败，作者行实测）；
- 匹配不上（公式碎块/图内文字/扫描页 OCR 文本）→ bbox=None：原版模式的
  核心优势就是页面本身由 pdfjs 原样渲染，匹配失败只是「不高亮」，零内容损失；
- PyMuPDF 坐标系 = top-left 原点 y 向下，旋转 0° 页与 pdfjs viewport 的
  scale 为直接乘法关系（前端 overlay 用 bbox × scale 定位）；
- 每次流水线运行重算（约 10 ms/页，Spike 实测量级），不新增缓存 key；
  跨页合并块 bbox = 首段（合并源 A）所在位置。
"""

import re

import pymupdf

from ocr.textlayer import _MD_NORM_ALPHA, _match_block, _md_norm

# 纯图片引用块（图表快照锚点）：渲染层已有原图，无需高亮
_IMG_ONLY = re.compile(r"^\s*!\[[^\]]*\]\([^)]+\)\s*$")


def attach_block_bboxes(file_path: str, pages: list) -> None:
    """为 pages（processor 最终结构）的每个 block 原地标注 bbox（或 None）。

    pages: [{"page": int, "blocks": [{"original": str, ...}]}]
    坐标超出页面的原始块会被裁剪到页矩形；空页/越界页安全跳过。
    """
    doc = pymupdf.open(file_path)
    try:
        for page in pages:
            if not isinstance(page, dict):
                continue
            pno = page.get("page")
            blocks = page.get("blocks") or []
            if not isinstance(pno, int) or pno < 0 or pno >= len(doc) or not blocks:
                continue
            p = doc[pno]
            raw = p.get_text("blocks")
            if not raw:
                for b in blocks:
                    if isinstance(b, dict):
                        b["bbox"] = None
                continue
            norms = [_md_norm(b[4]) for b in raw]
            norms_alpha = [_MD_NORM_ALPHA.sub("", (b[4] or "").lower()) for b in raw]
            page_rect = p.rect
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                o = (b.get("original") or "").strip()
                if not o or _IMG_ONLY.match(o):
                    b["bbox"] = None
                    continue
                h = _md_norm(o)[:24]
                hit = _match_block(h, norms, norms_alpha) if h else None
                if hit is None:
                    b["bbox"] = None
                    continue
                r = pymupdf.Rect(raw[hit][:4]) & page_rect
                b["bbox"] = (
                    [round(v, 1) for v in (r.x0, r.y0, r.x1, r.y1)]
                    if not r.is_empty
                    else None
                )
    finally:
        doc.close()
