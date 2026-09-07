"""翻译前文本清理与公式保护（阶段2-T5）。

实测问题（用户反馈"下划线还在、公式没处理"）：
- pymupdf4llm 把下划线保留为 <u>...</u> HTML，react-markdown 不渲染裸 HTML，
  原样露出（已在 textlayer._clean_html 处理，v9）；
- 行内 LaTeX（\\(O(ND)\\) 等）被原样喂给翻译模型，模型会尝试"翻译"公式，
  产出乱码或丢失；
- 数学密集块（公式被转成 _E_⁰ = _{e_ 1⁰_...} 的下划线碎片）翻译毫无意义，
  译文比原文更乱——直接跳过翻译保留原文。

本模块提供两个纯函数，processor 在送翻前调用：
- protect_math(text)：LaTeX 公式替换为 [[M<n>]] 占位符，译文返回后恢复；
- is_formula_block(md)：公式密度过高的块判定为公式块（不送翻）。
"""

import re

# 行内 \( ... \)（pymupdf4llm 输出的 LaTeX 行内公式定界符）
_MATH_INLINE = re.compile(r"\\\((.+?)\\\)", re.S)
# 块级 \[ ... \]
_MATH_DISPLAY = re.compile(r"\\\[(.+?)\\\]", re.S)
# $$ ... $$
_MATH_DOLLAR = re.compile(r"\$\$(.+?)\$\$", re.S)
# 已被 textlayer 转成 Unicode 的上/下标字符（公式碎片的典型成分）
_SUBSUP_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹ⁱⁿ⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙ"


def protect_math(text: str) -> tuple[str, object]:
    """把公式替换为 [[M<n>]] 占位符，返回 (保护后文本, restore 函数)。

    restore(译文) 把占位符换回原公式。模型若弄丢占位符，对应公式
    不恢复（宁可缺公式也不放模型改写过的乱码进去）。
    """
    store: list[str] = []

    def _sub(m: re.Match) -> str:
        store.append(m.group(0))
        return f"[[M{len(store) - 1}]]"

    text = _MATH_DISPLAY.sub(_sub, text)
    text = _MATH_DOLLAR.sub(_sub, text)
    text = _MATH_INLINE.sub(_sub, text)

    def restore(out: str) -> str:
        for i, orig in enumerate(store):
            out = out.replace(f"[[M{i}]]", orig)
        return out

    return text, restore


def is_formula_block(md: str) -> bool:
    """公式密度过高的块 → True（跳过翻译，译文=原文）。

    判定：噪声字符（下划线、上下标 Unicode、LaTeX 宏）数量 ≥8 且
    超过英文单词数——公式碎片里噪声远多于可读单词；普通正文段落
    即使带个别 file_name/下标也不会触达阈值。
    """
    t = md or ""
    if len(t) < 12:
        return False
    noise = t.count("_")
    noise += sum(t.count(c) for c in set(_SUBSUP_CHARS) if c in t)
    noise += len(re.findall(r"\\[a-zA-Z]+", t))
    words = len(re.findall(r"[A-Za-z]{2,}", t))
    return noise >= 8 and noise > words
