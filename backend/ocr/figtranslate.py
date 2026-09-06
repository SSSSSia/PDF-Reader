"""图表"译制图"生成（2026-09-06 用户需求）。

左栏显示原图快照，右栏显示译制图：保留图表的原始排版与图形，
只把图内文字换成译文——"原模原样的翻译版"。

流程：
1. 读快照 sidecar JSON（<fig>.json：区域坐标 + 图内逐行文字 bbox/字号/颜色）；
2. 在文档副本上 redact 区域内全部文字（图注在区域外/已豁免），
   渲染"无字背景图"（图形、线条、色块原样保留）；
3. 逐行调翻译 API 得到译文；
4. PIL 把译文按原坐标、原字号、原颜色叠回背景图（宽度超框自动缩字号）。

产物 <fig>.zh.png 与原图同尺寸同坐标，前端左右两栏直接对照。
任一环节失败都回退原图（translated = original），绝不阻断主流程。
"""
import asyncio
import json
import os
import re

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from translate.base import translate_batch

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

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _load_font(size: int) -> ImageFont.FreeTypeFont | None:
    """按字号加载 CJK 字体（带缓存）。找不到任何字体返回 None（用默认位图字体）。"""
    for path in _FONT_CANDIDATES:
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
        with pymupdf.open(src_pdf) as doc2:
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


def _overlay_text(bg_path: str, lines: list[dict], region: list[float], out_path: str) -> None:
    """把译文按原坐标叠到背景图上。bbox 为页面坐标，×倍率映射到像素。"""
    img = Image.open(bg_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    for ln in lines:
        translated = (ln.get("translated") or "").strip()
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


# 叠字逻辑版本号：改动叠字/翻译过滤逻辑时 +1，使旧译制图自动失效重生成
OVERLAY_VERSION = "v2"


async def translate_figure(
    sidecar_path: str, file_path: str | None = None, t_cfg: dict | None = None
) -> str | None:
    """生成一张译制图，返回译制图路径；失败返回 None（调用方回退原图）。

    sidecar_path 为 <fig>.json；译制图写在旁边 <fig>.zh<版本>.png。
    file_path 不传时用 sidecar 里记录的源 PDF（按需触发场景）。"""
    try:
        with open(sidecar_path, encoding="utf-8") as f:
            sidecar = json.load(f)
    except Exception:
        return None
    lines = sidecar.get("lines") or []
    if not lines:
        return None  # 图里没文字（纯图形），无需译制
    png = sidecar.get("png") or ""
    region = sidecar.get("region") or []
    page_num = sidecar.get("page")
    if not png or not region or not os.path.isfile(png) or page_num is None:
        return None
    src_pdf = file_path or sidecar.get("pdf") or ""
    if not src_pdf or not os.path.isfile(src_pdf):
        print("[figtranslate] 源 PDF 不可用，无法渲染无字背景")
        return None
    if t_cfg is None:
        t_cfg = {}

    zh_png = png[:-4] + f".zh.{OVERLAY_VERSION}.png"
    if os.path.isfile(zh_png):
        return zh_png  # 已生成过（重跑同一文件）

    source_lang = t_cfg.get("source_language", "en")
    target_lang = t_cfg.get("target_language", "zh")

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
        bg = os.path.splitext(png)[0] + ".bg.png"
        if not _render_textless_bg(src_pdf, page_num, region, bg):
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
