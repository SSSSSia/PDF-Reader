"""翻译前文本清理与公式保护（阶段2-T5，2026-09-07 按用户反馈收紧）。

实测问题（用户反馈"下划线还在、公式没处理、部分内容没翻译"）：
- pymupdf4llm 把下划线保留为 <u>...</u> HTML，react-markdown 不渲染裸 HTML，
  原样露出（已在 textlayer._clean_html 处理，v9）；
- 行内 LaTeX（\\(O(ND)\\) 等）被原样喂给翻译模型，模型会尝试"翻译"公式，
  产出乱码或丢失；
- 数学碎片块（公式被转成 _E_⁰ = _{e_ 1⁰_...} 的下划线碎片）。

设计演进：v1 对"公式密集块"整块跳过翻译——用户实测反馈部分正文跟着
丢了（混合块里有真实论述）。改为：
- is_formula_block 只跳过**纯公式块**（几乎没有可读单词，如独立成段的
  展示公式）；
- 混合块用 protect_formulas 做**片段级保护**：含 _/^/上下标/LaTeX 宏的
  空白 token 替换为占位符，正文照常翻译，译文返回后原样还原。
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
_SUBSUP_SET = set(_SUBSUP_CHARS)
# LaTeX 宏（\frac、\alpha…）
_MACRO = re.compile(r"\\[a-zA-Z]+")


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


def _is_math_token(tok: str) -> bool:
    """空白 token 是否公式碎片：剥掉首尾标点后含 _、^、上下标字符或 LaTeX 宏。"""
    core = tok.strip(".,;:!?()[]{}\"'`*|，。；：！？")
    if not core:
        return False
    if "_" in core or "^" in core:
        return True
    if any(c in _SUBSUP_SET for c in core):
        return True
    return bool(_MACRO.search(core))


def protect_formulas(text: str) -> tuple[str, object]:
    """两级公式保护，返回 (保护后文本, restore 函数)。

    1) protect_math：带定界符的 LaTeX（\\(..\\) 等）→ [[M<n>]]；
    2) 片段级：剩余文本按空白切 token，含 _/^/上下标/宏的 token → [[F<n>]]
       （实测 'E_0^0 = {e_1^0, ...}' 碎片若不保护，模型会当英文单词乱翻）。
    """
    text, r1 = protect_math(text)
    store: list[str] = []
    out_tokens: list[str] = []
    for tok in text.split(" "):
        if tok and _is_math_token(tok):
            store.append(tok)
            out_tokens.append(f"[[F{len(store) - 1}]]")
        else:
            out_tokens.append(tok)

    def restore(out: str) -> str:
        out = r1(out)
        for i, orig in enumerate(store):
            out = out.replace(f"[[F{i}]]", orig)
        return out

    return " ".join(out_tokens), restore


def is_formula_block(md: str) -> bool:
    """**纯公式块** → True（跳过翻译，译文=原文）。

    判定：几乎没有可读英文单词（<10 个）且公式噪声字符 ≥8——
    独立成段的展示公式属于此类；散文+公式混合块有真实内容，
    必须走 protect_formulas 保护后翻译（v1 整块跳过曾把正文一起
    丢掉，用户实测反馈）。
    """
    t = md or ""
    if len(t) < 12:
        return False
    words = len(re.findall(r"[A-Za-z]{2,}", t))
    if words >= 10:
        return False
    noise = t.count("_")
    noise += sum(t.count(c) for c in _SUBSUP_SET if c in t)
    noise += len(_MACRO.findall(t))
    return noise >= 8
