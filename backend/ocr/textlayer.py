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

# caption 行锚点（图快照插回 markdown 的定位依据）——只锚「图」注，
# 表格走 find_tables 排除不做快照，Table/表 caption 不应占用锚位
_FIG_CAPTION = re.compile(
    r"^\s*(?:Figure|Fig\.?|图)\s*\d+", re.IGNORECASE | re.MULTILINE
)
# 单行图注匹配（redact 时豁免图注文本块用）
_FIG_CAPTION_LINE = re.compile(
    r"^\s*(?:Figure|Fig\.?|图)\s*\d+", re.IGNORECASE
)
# 图表区域判定阈值
_MIN_FIG_RATIO = 0.015     # 面积占页面比例下限（过滤图标/装饰线；
                           # 0.03 实测会漏小图片表格——A4 上 150x80pt 的表约 2.5%）
_MAX_FIG_RATIO = 0.92      # 上限（过滤整页背景）
_MAX_FIG_TEXT_CHARS = 2000 # 区域内文本字符上限（兜底：防整页文本框误判；
                           # 矢量图表的轴标签/图例是真实文本，实测可达 1500+，
                           # 表格由 find_tables 精确排除，不靠文本数启发式）
_TABLE_OVERLAP = 0.3       # 与表格 bbox 重叠面积占比超过该值则排除
_FIG_SCALE = 2.5           # 快照渲染倍率（与视觉 OCR 一致）


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


def _merge_rects(rects: list) -> list:
    """合并相交矩形（迭代至稳定）。区域数量少，O(n²) 可接受。"""
    rects = [pymupdf.Rect(r) for r in rects if r and r.width > 1 and r.height > 1]
    changed = True
    while changed:
        changed = False
        out: list = []
        while rects:
            r = rects.pop()
            for i, o in enumerate(out):
                if r.intersects(o):
                    out[i] = o | r  # 并集
                    changed = True
                    break
            else:
                out.append(r)
        rects = out
    return rects


def _figure_regions(page, debug: bool = False) -> list:
    """检测页面的图表区域（栅格图 + 矢量绘图簇统一处理）。

    过滤规则：
    - 面积占比 [_MIN_FIG_RATIO, _MAX_FIG_RATIO]；
    - 与 find_tables 表格 bbox 重叠超 _TABLE_OVERLAP 的区域排除（表格
      不做快照——文本层已能完整提取表格内容，截图反而无法翻译）；
    - 区域内部文本超 _MAX_FIG_TEXT_CHARS 兜底排除（防整页文本框误判；
      注意矢量图表轴标签是真实文本，正常图表可达 1500+ 字符）。
    返回按 y0 排序的 Rect 列表。debug=True 时打印各环节计数与跳过原因。"""
    page_area = page.rect.width * page.rect.height
    rects: list = []
    try:
        for img in page.get_images(full=True):
            rects.extend(page.get_image_rects(img[0]))
    except Exception:
        pass
    try:
        rects.extend(page.cluster_drawings())
    except Exception:
        pass
    # 表格 bbox（一次检测，供重叠排除；失败不阻断）
    table_boxes: list = []
    try:
        table_boxes = [t.bbox for t in page.find_tables().tables]
    except Exception:
        pass
    merged = _merge_rects(rects)
    if debug:
        print(
            f"[figure] p{page.number + 1}: 栅格rect={len(rects) - 0} "
            f"矢量簇候选={len(merged)} 表格bbox={len(table_boxes)}"
        )
    figs = []
    for r in merged:
        r = r & page.rect  # 裁剪到页面内
        if r.is_empty:
            continue
        ratio = r.width * r.height / page_area
        if ratio < _MIN_FIG_RATIO or ratio > _MAX_FIG_RATIO:
            if debug:
                print(f"[figure] p{page.number + 1}: 跳过(面积比{ratio:.3f}) {r}")
            continue
        skip = False
        for tb in table_boxes:
            inter = r & pymupdf.Rect(tb)
            if not inter.is_empty and inter.get_area() > _TABLE_OVERLAP * r.get_area():
                skip = True  # 主体是表格，不快照
                break
        if skip:
            if debug:
                print(f"[figure] p{page.number + 1}: 跳过(表格重叠) {r}")
            continue
        try:
            text_chars = len(page.get_text("text", clip=r).strip())
        except Exception:
            text_chars = 0
        if text_chars > _MAX_FIG_TEXT_CHARS:
            if debug:
                print(f"[figure] p{page.number + 1}: 跳过(文本{text_chars}过密) {r}")
            continue  # 文本过密（整页文本框），兜底排除
        figs.append(r)
    figs.sort(key=lambda r: (r.y0, r.x0))
    return figs


def _figure_inner_text_rects(page, regions: list) -> list:
    """返回图表区域内部的文本块 bbox（用于 redact 剔除，2026-09-06 用户反馈）。

    图/表内部的文字（表格数字、轴标签、图例）若按正文提取会变成乱码段落
    且被重复翻译——快照图已"原模原样"包含它们，文本层必须剔除。
    图注文本块（Figure N/图 N 开头）豁免，保住 _insert_figures 的锚点。"""
    out: list = []
    for b in page.get_text("blocks"):
        r = pymupdf.Rect(b[0], b[1], b[2], b[3])
        if r.is_empty:
            continue
        text = (b[4] if len(b) > 4 else "").strip()
        for reg in regions:
            inter = r & reg
            if inter.is_empty:
                continue
            # 块主体（>60% 面积）落在区域内才算图表内部文字
            if inter.get_area() < 0.6 * max(r.get_area(), 1.0):
                continue
            if _FIG_CAPTION_LINE.match(text):
                break  # 图注豁免，保留文本与锚点
            out.append(r)
            break
    return out


def _region_lines(page, region) -> list[dict]:
    """提取区域内逐行文字（bbox/字号/颜色），供"译制图"叠字用。

    坐标为页面坐标（与 region 同系）；图注行豁免——它由正文文本层
    负责翻译，不进译制图。"""
    import json

    lines: list[dict] = []
    try:
        d = page.get_text("dict", clip=region)
    except Exception:
        return lines
    for blk in d.get("blocks", []):
        if blk.get("type") != 0:
            continue  # 只取文本块
        for line in blk.get("lines", []):
            text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
            if not text or _FIG_CAPTION_LINE.match(text):
                continue
            spans = [s for s in line.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            size = max(s.get("size", 10.0) for s in spans)
            color = spans[0].get("color", 0)
            lines.append(
                {
                    "text": text,
                    "bbox": [round(v, 2) for v in line["bbox"]],
                    "size": round(size, 1),
                    "color": int(color),
                }
            )
    return lines


def _snapshot_figures(doc, page_num: int, image_dir: str, debug: bool = True) -> list[str]:
    """把页面图表区域截图为 PNG，返回可插入 markdown 的图片引用列表（按 y 序）。

    同时落盘 sidecar JSON（<fig>.json：区域坐标 + 图内逐行文字元数据），
    供翻译阶段生成"译制图"（原排版+译文叠字，2026-09-06 用户需求）。"""
    import json

    page = doc[page_num]
    refs: list[str] = []
    for k, r in enumerate(_figure_regions(page, debug=debug)):
        path = os.path.join(image_dir, f"fig_p{page_num + 1:03d}_{k:02d}.png")
        try:
            pix = page.get_pixmap(
                clip=r, matrix=pymupdf.Matrix(_FIG_SCALE, _FIG_SCALE)
            )
            pix.save(path)
        except Exception:
            continue  # 单个快照失败不阻断整页
        if debug:
            print(f"[figure] p{page_num + 1}: 快照#{k} -> {os.path.basename(path)} {r}")
        # sidecar：译制图的原料（区域 + 图内逐行文字）
        try:
            sidecar = {
                "png": path.replace(os.sep, "/"),
                "page": page_num,
                "region": [round(v, 2) for v in list(r)],
                "lines": _region_lines(page, r),
            }
            with open(path + ".json", "w", encoding="utf-8") as f:
                json.dump(sidecar, f, ensure_ascii=False)
        except Exception:
            pass  # sidecar 失败只影响译制图，不影响快照
        refs.append(f"![Figure]({path.replace(os.sep, '/')})")
    return refs


def _insert_figures(md: str, refs: list[str]) -> str:
    """把图快照引用插回 markdown（caption 锚定，v1 启发式）：

    学术惯例 caption 紧跟图的下方——第 k 个快照（按页面 y 序）插到
    markdown 中第 k 个 caption 行之前，即「图在上、caption 在下」。
    caption 数不足时，多余快照追加到页末。"""
    if not refs:
        return md
    marks = [m.start() for m in _FIG_CAPTION.finditer(md)]
    # 从后往前插，避免位移
    for k in range(len(refs) - 1, -1, -1):
        ref = f"\n\n{refs[k]}\n\n"
        if k < len(marks):
            pos = marks[k]
            md = md[:pos] + ref + md[pos:]
        else:
            md = md.rstrip("\n") + "\n\n" + refs[k] + "\n"
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
    图片策略（用户反馈"图片原模原样显示"，2026-09-06）：
    - 不再使用 pymupdf4llm 的 write_images（栅格图常被拆成几十张碎片）；
    - 统一走 _snapshot_figures：检测「栅格图区域 + 矢量绘图簇」（合并、
      面积/文本密度过滤），高清截图后按 caption 锚定插回 markdown——
      矢量图表（LaTeX/绘图导出）也能原样显示。
    - 图表内部文字 redact 剔除（用户反馈"图片被转成文字重复翻译"，同日）：
      在文档副本上对区域内的文本块做 redaction（图注豁免），pymupdf4llm
      改在副本上提取——图内文字只存在于快照图中，不再变成乱码段落。
    单页提取约 0.5-1s（表格检测+redact 副本），上层逐页调用实现首页秒开。
    """
    doc = pymupdf.open(file_path)
    try:
        out: list[str | None] = []
        for idx, pno in enumerate(page_nums):
            # 1) 先在原文档上快照（渲染含图内文字，所见即所得）
            refs = (
                _snapshot_figures(doc, pno, image_dir) if image_dir else []
            )
            # 2) 提取文本：有图表区域的页在 redact 副本上提取
            page = doc[pno]
            regions = _figure_regions(page, debug=False) if refs else []
            inner = _figure_inner_text_rects(page, regions) if regions else []
            if inner and refs:
                with pymupdf.open(file_path) as doc2:
                    page2 = doc2[pno]
                    for r in inner:
                        page2.add_redact_annot(r)
                    try:
                        page2.apply_redactions(
                            images=pymupdf.PDF_REDACT_IMAGE_NONE
                        )
                    except TypeError:
                        page2.apply_redactions()
                    chunks = pymupdf4llm.to_markdown(
                        doc2, page_chunks=True, pages=[pno]
                    )
                if refs:
                    print(f"[figure] p{pno + 1}: redact 图内文本块 {len(inner)} 个")
            else:
                chunks = pymupdf4llm.to_markdown(doc, page_chunks=True, pages=[pno])
            c = chunks[0] if chunks else {}
            md = (c.get("text") or "").strip()
            if md:
                md = _clean_html(md)
                if image_dir:
                    md = _normalize_image_refs(md, image_dir)
                    md = _insert_figures(md, refs)
            # 有快照的页即使文字变短也算有效文本层（文字进了图，不回退 OCR）
            out.append(md if (len(md) >= MIN_TEXT_CHARS or refs) else None)
        return out
    finally:
        doc.close()


def extract_all(file_path: str, image_dir: str | None = None) -> list[str | None]:
    """提取全部页面的文本层 Markdown（兼容入口，内部走 extract_pages）。"""
    return extract_pages(file_path, list(range(count_pages(file_path))), image_dir)
