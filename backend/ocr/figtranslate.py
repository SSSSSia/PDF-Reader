"""图表"译制图"生成（2026-09-06 用户需求）。

两类对象两条路径（v3，2026-09-06 用户反馈表格叠字不可读后重构）：

- 表格（tab_*，kind=table）：结构化重建。表格有真实行列结构
  （find_tables 可解析），抽取单元格 → 逐格批量翻译 → PIL 重画一张
  干净的网格表格（自动列宽、自动折行、表头底色加粗）。
  旧方案"redact 背景 + 原坐标叠回译文"对表格必然失败：中文译文比
  英文原文长好几倍，单行叠字互相穿插重叠（实测踩坑，用户截图）。

- 图（fig_*）：坐标叠回。保留图表的原始排版与图形，只把图内文字
  换成译文——图内文字多为短标签，叠回效果可接受。
  1. 读快照 sidecar JSON（<fig>.json：区域坐标 + 图内逐行文字 bbox/字号/颜色）；
  2. 在文档副本上 redact 区域内全部文字（图注在区域外/已豁免），
     渲染"无字背景图"（图形、线条、色块原样保留）；
  3. 逐行调翻译 API 得到译文；
  4. PIL 把译文按原坐标、原字号、原颜色叠回背景图（宽度超框自动缩字号）。

产物 <fig>.zh.png 与原图同位置存放，前端就地替换显示。
任一环节失败都回退原图（translated = original），绝不阻断主流程。
"""
import asyncio
import json
import os
import re

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from translate.base import translate_batch, translate_text

# 渲染倍率：与 textlayer._FIG_SCALE 保持一致，坐标换算共用
_FIG_SCALE = 2.5
# 译制图文字最小字号（pt，小于则不再缩小、允许溢出）
_MIN_FONT_SIZE = 5.0
# 单次批量翻译的行数上限（行多时分批）
_BATCH_SIZE = 20

_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",  # 微软雅黑（Win10+ 必有）
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

_FONT_BOLD_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",  # 微软雅黑 Bold
    r"C:\Windows\Fonts\simhei.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

# 最近一次失败原因（供接口 detail 透传给前端显示，替代静默 500）
_last_error = ""


def last_error() -> str:
    return _last_error


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | None:
    """按字号加载 CJK 字体（带缓存）。找不到任何字体返回 None（用默认位图字体）。"""
    for path in _FONT_BOLD_CANDIDATES if bold else _FONT_CANDIDATES:
        if os.path.isfile(path):
            key = (path, size)
            if key not in _font_cache:
                try:
                    _font_cache[key] = ImageFont.truetype(path, size)
                except Exception:
                    continue
            return _font_cache[key]
    return None


def _int_to_rgb(color: int) -> tuple[int, int, int]:
    """PyMuPDF 的 sRGB 整数色 → PIL RGB 元组。"""
    return ((color >> 16) & 255, (color >> 8) & 255, color & 255)


# 纯标识符/数值标签：型号名（GPT-4o-mini、DALK）、数据集名（WebQSP）、分数等
# ——这类翻译只会产生截断乱码，本地化图表惯例也是原样保留。
# 注意：字符类里不能有空格！上一版把 \s 放进去，导致所有带空格的英文短语
#（Formation of one tree layer 等）被误判为标识符而整图跳过翻译（实测踩坑）
_PLAIN_TOKEN = re.compile(r"^[A-Za-z0-9_\-·.:/()%+≥≤±×—=|,]+$")


def _needs_translation(text: str, target_lang: str) -> bool:
    t = (text or "").strip()
    if len(t) <= 3:
        return False
    # 连字符短语（Fill-in-blank / Multi-choice / True-or-false）要翻译——
    # 必须放在 _PLAIN_TOKEN 之前：它们恰好全部落在标识符字符类里，
    # 先查标识符会提前放行（实测表头全英文的踩坑）。
    # 型号名（G-Retriever / GPT-4o-mini：首段非"大写+小写"形态）仍是标识符。
    if re.match(r"^[A-Z][a-z]+(-[a-z]+)+$", t):
        return True
    if _PLAIN_TOKEN.match(t):
        return False
    # 译中文：没有任何英文字母的行（纯数字/符号/已是中文）无需翻译
    if target_lang.lower().startswith("zh") and not re.search(r"[A-Za-z]", t):
        return False
    return True


def _render_textless_bg(file_path: str, page_num: int, region: list[float], out_path: str) -> bool:
    """渲染"去文字背景图"：redact 副本上去掉区域内所有文字后截图。

    images=NONE 保留位图、graphics=LINE_ART_NONE 保留矢量线条
    （图表的柱形/折线/坐标轴都是矢量——默认会被一起删掉，实测踩坑），
    只移除文字。失败返回 False（调用方回退原图）。"""
    try:
        with pymupdf.open(file_path) as doc2:
            page = doc2[page_num]
            r = pymupdf.Rect(*region)
            page.add_redact_annot(r)
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            )
            pix = page.get_pixmap(
                clip=r, matrix=pymupdf.Matrix(_FIG_SCALE, _FIG_SCALE)
            )
            pix.save(out_path)
            return True
    except Exception as e:
        print(f"[figtranslate] 背景渲染失败: {e}")
        return False


def _clean_translated(t: str) -> str:
    """剥掉翻译模型夹带的 markdown 装饰符（### 标题、**加粗、` 代码等）——
    叠字场景里它们只会变成乱码符号（实测踩坑）。"""
    t = re.sub(r"^[#\s`>*\-]+", "", t or "")
    t = t.replace("**", "").replace("`", "").replace("__", "")
    return t.strip()


# ---------- 表格：结构化重建（v3，2026-09-06 用户反馈叠字不可读后新增） ----------

# 表格渲染参数（像素；2x 于页面渲染，观感与快照一致）
_TABLE_FONT_PX = 20
_TABLE_LINE_H = 28  # 行高（含行距）
_TABLE_PAD_X, _TABLE_PAD_Y = 10, 7
_TABLE_MIN_COL_W = 56  # 单列最小宽
_TABLE_MAX_COL_W = 430  # 单列最大宽（超出折行）
_TABLE_GAP = 20  # 同一快照区域内多张表之间的间距
_GRID_COLOR = (148, 163, 184)  # 网格线 slate-400
_HEADER_BG = (241, 245, 249)  # 表头底色 slate-100
_TEXT_COLOR = (15, 23, 42)  # 正文 slate-900

# 表格单元格专用提示：通用翻译提示下，Qwen3 对短术语常原样返回
# （实测 "Multi-choice" → "Multi-choice"，2026-09-06 踩坑）
_CELL_PROMPT = (
    "你是学术文献表格翻译助手。把给定的英文表格单元格文本翻译为简体中文。"
    "列名和表头短语（如 Multi-choice、True-or-false、Retrieval operators）"
    "必须译成对应的中文术语；方法名、数据集名、模型名、数字和单位原样保留；"
    "只输出译文本身，不要解释、不要加粗符号、不要附原文。"
)


_Y_TOL = 3.5  # 视觉行聚类容差（pt）
_COL_GAP_MIN = 7.0  # 词间隙超过该值视为列边界（pt）


def _region_tables(src_pdf: str, page_num: int, region: list[float]) -> list[list[list[str]]]:
    """从词坐标重建快照区域内的表格，返回按块（多张表）组织的行列表。

    不用 find_tables：实测这类表格线不全，它会把整个数据区并成一个
    大单元格（方法名/数字全部挤在一列，2026-09-06 用户截图踩坑）。
    改用"表格列垂直对齐"特性：
    1. 词按 y 中心聚类成视觉行；
    2. 行内按词间隙（> _COL_GAP_MIN）切列；
    3. 行间距显著变大处切分为多张表；
    4. 丢弃混进区域的段落/图注行（单格且超长）。"""
    try:
        with pymupdf.open(src_pdf) as doc2:
            page = doc2[page_num]
            r = pymupdf.Rect(*region)
            words = [
                w for w in page.get_text("words")
                if pymupdf.Rect(w[:4]).intersects(r)
            ]
            if not words:
                return []
            # 1) y 聚类成视觉行
            words.sort(key=lambda w: (w[1], w[0]))
            vlines: list[tuple[float, list]] = []
            for w in words:
                yc = (w[1] + w[3]) / 2
                if vlines and abs(yc - vlines[-1][0]) <= _Y_TOL:
                    vlines[-1][1].append(w)
                else:
                    vlines.append((yc, [w]))
            # 2) 行内按间隙切列
            combined: list[tuple[float, list[str]]] = []
            for yc, ws in vlines:
                ws.sort(key=lambda w: w[0])
                cells, cur = [], [ws[0]]
                for a, b in zip(ws, ws[1:]):
                    if b[0] - a[2] > _COL_GAP_MIN:
                        cells.append(cur)
                        cur = [b]
                    else:
                        cur.append(b)
                cells.append(cur)
                combined.append((yc, [" ".join(x[4] for x in c) for c in cells]))
            # 4) 丢弃混入的段落/图注行（单格超长；表头跨列行如 Accuracy 很短不受影响）
            combined = [(y, rw) for y, rw in combined
                        if not (len(rw) == 1 and len(rw[0]) > 60)]
            if not combined:
                return []
            # 3) 行间距显著变大处切分为多张表
            gaps = [b[0] - a[0] for a, b in zip(combined, combined[1:])]
            med = sorted(gaps)[len(gaps) // 2] if gaps else 0.0
            thr = max(med * 2.5, 15.0)
            blocks: list[list[list[str]]] = []
            cur_block = [combined[0][1]]
            for (ya, ra), (yb, rb) in zip(combined, combined[1:]):
                if yb - ya > thr:
                    blocks.append(cur_block)
                    cur_block = []
                cur_block.append(rb)
            if cur_block:
                blocks.append(cur_block)
            return blocks
    except Exception as e:
        print(f"[figtranslate] 表格结构解析失败: {e}")
        return []


async def _translate_cells(
    tables: list[list[list[str]]],
    source_lang: str,
    target_lang: str,
    t_cfg: dict,
) -> bool:
    """逐格并发翻译（每格独立请求），原地回填。始终返回 True：
    单格失败只影响那一格（保留原文），不让整图失败。

    不走 translate_batch 的合并协议：表格单元格是短文本，实测合并翻译
    会诱发模型幻觉——给 "Retrieval operators" 返回两千字的跑题示例
    （2026-09-06 用户截图踩坑）。并发单发既快又稳。"""
    global _last_error
    uniq: dict[str, str] = {}
    for rows in tables:
        for row in rows:
            for c in row:
                if c and _needs_translation(c, target_lang):
                    uniq.setdefault(c, c)
    items = list(uniq)

    async def _one(t: str) -> str:
        try:
            cell_cfg = {**t_cfg, "system_prompt": _CELL_PROMPT}
            return _clean_translated(
                await translate_text(t, source_lang, target_lang, cell_cfg)
            )
        except Exception as e:
            print(f"[figtranslate] 单元格翻译失败（保留原文）: {t[:20]}…: {e}")
            return ""

    outs = await asyncio.gather(*(_one(t) for t in items))
    for k, o in zip(items, outs):
        # 译文为空或长度异常（模型幻觉跑题的典型特征）→ 保留原文。
        # 上限放宽到 8 倍：模型习惯"译文（附原文）"，正常译文也不短
        uniq[k] = o if o and len(o) <= max(8 * len(k) + 40, 120) else k
    for rows in tables:
        for ri, row in enumerate(rows):
            rows[ri] = [uniq.get(c, c) for c in row]
    return True


def _wrap_cell(text: str, font, maxw: int, measure) -> list[str]:
    """单元格文本折行：优先按空格断词，超长单词按字符硬断。"""
    text = (text or "").replace("\n", " ").strip()
    if not text:
        return [""]
    lines: list[str] = []
    cur = ""
    for word in text.split(" "):
        cand = f"{cur} {word}" if cur else word
        if measure.textlength(cand, font=font) <= maxw:
            cur = cand
            continue
        if cur:
            lines.append(cur)
            cur = ""
        while measure.textlength(word, font=font) > maxw and len(word) > 1:
            keep = 1
            for k in range(2, len(word) + 1):
                if measure.textlength(word[:k], font=font) <= maxw:
                    keep = k
                else:
                    break
            lines.append(word[:keep])
            word = word[keep:]
        cur = word
    if cur:
        lines.append(cur)
    return lines or [""]


def _render_tables_png(tables: list[list[list[str]]], out_path: str) -> None:
    """把（已翻译的）表格行渲染为干净网格 PNG。自动列宽/折行/表头样式。"""
    font = _load_font(_TABLE_FONT_PX)
    bold = _load_font(_TABLE_FONT_PX, bold=True) or font
    font = font or bold
    measure = ImageDraw.Draw(Image.new("RGB", (8, 8)))

    def _layout(rows: list[list[str]]):
        ncol = max(len(r) for r in rows)
        rows = [list(r) + [""] * (ncol - len(r)) for r in rows]
        col_w = []
        for c in range(ncol):
            w = _TABLE_MIN_COL_W
            for r in rows:
                for seg in str(r[c]).split("\n"):
                    w = max(w, measure.textlength(seg, font=font))
            col_w.append(min(int(w) + _TABLE_PAD_X * 2, _TABLE_MAX_COL_W))
        grid = []
        for ri, r in enumerate(rows):
            f = bold if ri == 0 else font
            grid.append([_wrap_cell(c, f, col_w[ci] - _TABLE_PAD_X * 2, measure)
                         for ci, c in enumerate(r)])
        row_h = [max(len(c) for c in cells) * _TABLE_LINE_H + _TABLE_PAD_Y * 2
                 for cells in grid]
        return col_w, grid, row_h

    blocks = [_layout(rows) for rows in tables]
    W = max(sum(cw) for cw, _, _ in blocks) + 2
    H = sum(sum(rh) for _, _, rh in blocks) + _TABLE_GAP * (len(blocks) - 1) + 2
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)

    y = 1
    for bi, (col_w, grid, row_h) in enumerate(blocks):
        ncol = len(col_w)
        xs = [1]
        for w in col_w:
            xs.append(xs[-1] + w)
        top = y
        for ri, cells in enumerate(grid):
            rh = row_h[ri]
            if ri == 0:
                d.rectangle([xs[0], y, xs[-1], y + rh], fill=_HEADER_BG)
            f = bold if ri == 0 else font
            for ci, lines in enumerate(cells):
                ty = y + _TABLE_PAD_Y
                tx = xs[ci] + _TABLE_PAD_X
                for ln in lines:
                    d.text((tx, ty), ln, fill=_TEXT_COLOR, font=f)
                    ty += _TABLE_LINE_H
            y += rh
            d.line([xs[0], y, xs[-1], y], fill=_GRID_COLOR, width=1)
        for x in xs:
            d.line([x, top, x, y], fill=_GRID_COLOR, width=1)
        y += _TABLE_GAP
    img.save(out_path)


def _overlay_text(bg_path: str, lines: list[dict], region: list[float], out_path: str) -> None:
    """把译文按原坐标叠到背景图上。bbox 为页面坐标，×倍率映射到像素。"""
    img = Image.open(bg_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    for ln in lines:
        translated = _clean_translated(ln.get("translated") or "")
        if not translated:
            continue
        x0, y0, x1, y1 = ln["bbox"]
        # 相对区域坐标 × 倍率 = 像素坐标
        px0 = (x0 - region[0]) * _FIG_SCALE
        py0 = (y0 - region[1]) * _FIG_SCALE
        box_w = max((x1 - x0) * _FIG_SCALE, 8.0)
        size_pt = max(ln.get("size", 10.0), _MIN_FONT_SIZE)
        px_size = max(int(round(size_pt * _FIG_SCALE)), 8)
        font = _load_font(px_size)
        color = _int_to_rgb(ln.get("color", 0))
        if font is not None:
            # 宽度超框自动缩字号（中文译文常比原文长）
            while px_size > 8:
                try:
                    w = draw.textlength(translated, font=font)
                except Exception:
                    break
                if w <= box_w * 1.08:
                    break
                px_size -= 1
                font = _load_font(px_size)
                if font is None:
                    break
        # 缩到最小仍超框 → 截断加省略号（重叠的乱图比截断更不可读）
        if font is not None:
            try:
                while len(translated) > 2 and draw.textlength(translated, font=font) > box_w * 1.08:
                    translated = translated[:-2].rstrip() + "…"
            except Exception:
                pass
        try:
            draw.text((px0, py0), translated, fill=color, font=font)
        except Exception:
            continue  # 单行失败不影响整图
    img.save(out_path)


# 译制图版本号：改动生成逻辑时 +1，使旧译制图自动失效重生成
# v3：表格改结构化重建（叠字方案对表格不可读，2026-09-06 用户反馈）
OVERLAY_VERSION = "v3"


async def translate_figure(
    sidecar_path: str, file_path: str | None = None, t_cfg: dict | None = None
) -> str | None:
    """生成一张译制图，返回译制图路径；失败返回 None（调用方回退原图）。

    sidecar_path 为 <fig>.json；译制图写在旁边 <fig>.zh<版本>.png。
    file_path 不传时用 sidecar 里记录的源 PDF（按需触发场景）。
    表格走结构化重建（_region_tables 解析成功时），图走坐标叠回。"""
    global _last_error
    _last_error = ""
    try:
        with open(sidecar_path, encoding="utf-8") as f:
            sidecar = json.load(f)
    except Exception as e:
        _last_error = f"无法读取表格元数据: {e}"
        return None
    png = sidecar.get("png") or ""
    region = sidecar.get("region") or []
    page_num = sidecar.get("page")
    if not png or not region or not os.path.isfile(png) or page_num is None:
        _last_error = "快照元数据不完整（png/region/page 缺失或快照文件不存在）"
        return None
    src_pdf = file_path or sidecar.get("pdf") or ""
    if not src_pdf or not os.path.isfile(src_pdf):
        _last_error = f"源 PDF 不可用: {src_pdf or '(空)'}"
        print(f"[figtranslate] 源 PDF 不可用，无法渲染无字背景")
        return None
    if t_cfg is None:
        t_cfg = {}
    source_lang = t_cfg.get("source_language", "en")
    target_lang = t_cfg.get("target_language", "zh")

    zh_png = png[:-4] + f".zh.{OVERLAY_VERSION}.png"
    if os.path.isfile(zh_png):
        return zh_png  # 已生成过（重复点击幂等）

    # ---------- 表格：结构化重建（解析出真实行列才能走这条路） ----------
    if sidecar.get("kind") == "table":
        tables = await asyncio.to_thread(_region_tables, src_pdf, page_num, region)
        if tables:
            if not await _translate_cells(tables, source_lang, target_lang, t_cfg):
                return None

            def _render_tables() -> str | None:
                try:
                    _render_tables_png(tables, zh_png)
                    return zh_png
                except Exception as e:
                    global _last_error
                    _last_error = f"表格重绘失败: {e}"
                    print(f"[figtranslate] 表格重绘失败: {e}")
                    return None

            return await asyncio.to_thread(_render_tables)
        # 解析不出结构（如扫描版表格）→ 落到下面的叠回路径兜底
        print("[figtranslate] 表格结构解析为空，回退坐标叠回")

    # ---------- 图（fig_*）/ 兜底：坐标叠回 ----------
    lines = sidecar.get("lines") or []
    if not lines:
        _last_error = "图内没有可翻译的文字（纯图形或无文本层）"
        return None  # 图里没文字（纯图形），无需译制

    # 1) 批量翻译图内文字。
    #    标识符/数值行原样叠回（不浪费 API 也不产生截断乱码）；
    #    已翻过的行持久化在 sidecar 里，重渲染不重复调 API。
    #    译文与原文相同（历史错误缓存，如标识符误判版过滤的产物）→ 重翻。
    for ln in lines:
        if not _needs_translation(ln["text"], target_lang):
            ln["translated"] = ln["text"]
    missing = [
        ln
        for ln in lines
        if "translated" not in ln
        or not ln["translated"].strip()
        or ln["translated"].strip() == ln["text"].strip()
    ]
    if missing:
        texts = [ln["text"] for ln in missing]
        translated: list[str] = []
        try:
            for i in range(0, len(texts), _BATCH_SIZE):
                batch = texts[i : i + _BATCH_SIZE]
                outs = await translate_batch(batch, source_lang, target_lang, t_cfg)
                if len(outs) != len(batch):
                    return None
                translated.extend(outs)
        except Exception as e:
            _last_error = f"图内文字翻译失败: {e}"
            print(f"[figtranslate] 图内文字翻译失败: {e}")
            return None
        for ln, tr in zip(missing, translated):
            ln["translated"] = tr
        try:
            with open(sidecar_path, "w", encoding="utf-8") as f:
                json.dump(sidecar, f, ensure_ascii=False)
        except Exception:
            pass

    # 2) 无字背景 + 叠字（PIL 渲染是 CPU 密集，放线程）
    def _render() -> str | None:
        global _last_error
        bg = os.path.splitext(png)[0] + ".bg.png"
        if not _render_textless_bg(src_pdf, page_num, region, bg):
            _last_error = "无字背景渲染失败（见后端日志）"
            return None
        try:
            _overlay_text(bg, lines, region, zh_png)
            return zh_png
        finally:
            try:
                os.remove(bg)
            except OSError:
                pass

    return await asyncio.to_thread(_render)
