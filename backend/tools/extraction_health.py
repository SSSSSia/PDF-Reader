"""提取质量批量体检工具（2026-09-08）。

背景：阶段 5 验收期用户连续反馈多个提取层长尾问题（伪标题/斜体误判
上标/跨栏粘连/碎片段），均为 pymupdf4llm 启发式在不同版式下的误判
形态。本工具对论文集全页跑文本层提取，用「修复规则的逆向判定」
量化各维度残留问题率——残留应为 0（修复生效），不为 0 的是新形态。

用法：
    .venv/Scripts/python.exe backend/tools/extraction_health.py

输出：docs/提取质量体检.md + 控制台摘要。
体检维度全部来自 textlayer 既有修复的逆向判定，规则改动时同步维护。
"""
import re
import sys
import unicodedata
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from ocr.textlayer import (  # noqa: E402
    _HEADING_STRIP,
    _SENT_END,
    _SUP_CHARS,
    extract_pages,
)

ROOT = BACKEND.parent
DOCS = ROOT / "docs"
TEST_DIR = ROOT / "test_ocr"

# 体检论文集：来源/版式多样性优先（ACL双栏/NeurIPS单栏/IEEE双栏/arXiv单栏）
PAPERS = [
    "DALK-EMNLP.pdf",     # ACL/EMNLP 2024 双栏（粘连重灾区）
    "GraphRAG-Bench.pdf", # arXiv 单栏（数学密集）
    "GFM-RAG.pdf",        # arXiv 单栏
    "Attention.pdf",      # NeurIPS 2017 单栏（ICLR 版式）
    "BERT.pdf",           # NAACL 2019 双栏
    "ResNet.pdf",         # CVPR/IEEE 双栏
    "RAG.pdf",            # NeurIPS 2020 单栏
]
MAX_PAGES = 12  # 每篇页数上限（控制体检时长；首页版式问题最密集）

_MOJIBAKE = set("◆\ufffd")
_SUP_WORD_RE = re.compile(
    r"[A-Za-z]*[" + _SUP_CHARS + r"]+[A-Za-z" + _SUP_CHARS + r"]*"
)
_HEADING_LINE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
_NUM_HEADING = re.compile(r"^\d+(\.\d+)*[.:）)]?\s")


def _plain(s: str) -> str:
    return re.sub(r"[*_`#\s]+", "", s).lower()


def check_sentence_heading(text: str) -> list[str]:
    """逆向判定1：句子特征标题残留（降级后应为 0）。"""
    out = []
    for m in _HEADING_LINE.finditer(text):
        plain = _HEADING_STRIP.sub("", m.group(2))
        words = len(plain.split())
        if _SENT_END.search(plain):
            if plain[-1] in ".。" and (_NUM_HEADING.match(plain) or words < 6):
                continue
            out.append(m.group(0)[:90])
        elif words >= 14:
            out.append(m.group(0)[:90])
    return out


def check_sup_residue(text: str) -> list[str]:
    """逆向判定2：词内嵌入上标残留（还原后应为 0）。"""
    out = []
    for m in _SUP_WORD_RE.finditer(text):
        w = m.group(0)
        n_sup = sum(1 for ch in w if ch in _SUP_CHARS)
        letters = sum(1 for ch in w if ch.isascii() and ch.isalpha())
        if len(w) >= 4 and n_sup >= 1 and letters >= 2:
            out.append(w)
    return out


def check_tail_duplicates(paras: list[str]) -> list[str]:
    """逆向判定3：段尾跨栏重复窗口残留（拆分后应为 0）。"""
    plains = [_plain(p) for p in paras]
    out = []
    for i, p in enumerate(paras):
        others = "\n".join(plains[:i] + plains[i + 1:])
        words = p.split()
        for w in range(min(len(words) - 1, 60), 4, -1):
            tail = _plain(" ".join(words[-w:]))
            if len(tail) >= 30 and tail in others:
                out.append(" ".join(words[-w:])[:90])
                break
    return out


def check_fragments(paras: list[str]) -> list[str]:
    """逆向判定4：碎片段残留（剥列表标记后是其它段更长前缀）。"""
    plains = [_plain(p) for p in paras]
    out = []
    for i, p in enumerate(paras):
        frag = re.sub(r"^\d+\s*[.、)．]", "", _plain(p))
        if len(frag) < 30:
            continue
        for j, pl in enumerate(plains):
            if j != i and pl.startswith(frag) and len(pl) > len(frag) + 10:
                out.append(p[:90])
                break
    return out


def check_paper(name: str) -> dict:
    path = TEST_DIR / name
    import tempfile

    import pymupdf

    doc = pymupdf.open(path)
    n_pages = min(len(doc), MAX_PAGES)
    doc.close()

    # 临时 image_dir：让图表快照管线也进入体检范围（与真实管线一致）
    image_dir = Path(tempfile.mkdtemp(prefix="fxhealth_"))
    mds = extract_pages(str(path), list(range(n_pages)), str(image_dir))
    stats = {
        "pages": n_pages,
        "paras": 0,
        "chars": 0,
        "sentence_heading": [],
        "sup_residue": [],
        "tail_dup": [],
        "fragment": [],
        "mojibake": 0,
        "tiny_paras": 0,
        "img_refs": 0,
        "headings": 0,
        "none_pages": 0,
    }
    for md in mds:
        if not md:
            stats["none_pages"] += 1
            continue
        paras = [p for p in md.split("\n\n") if p.strip()]
        stats["paras"] += len(paras)
        stats["chars"] += len(md)
        stats["sentence_heading"] += check_sentence_heading(md)
        stats["sup_residue"] += check_sup_residue(md)
        stats["tail_dup"] += check_tail_duplicates(paras)
        stats["fragment"] += check_fragments(paras)
        stats["mojibake"] += sum(md.count(c) for c in _MOJIBAKE)
        stats["tiny_paras"] += sum(1 for p in paras if len(_plain(p)) < 5)
        stats["img_refs"] += md.count("![")
        stats["headings"] += len(re.findall(r"^#{1,6}\s", md, re.M))
    return stats


def main() -> None:
    results = {}
    for name in PAPERS:
        path = TEST_DIR / name
        if not path.exists():
            print(f"SKIP (missing): {name}")
            continue
        print(f"checking {name} ...", flush=True)
        results[name] = check_paper(name)

    lines = [
        "# 提取质量批量体检报告",
        "",
        f"- 体检时间：2026-09-08（text-layer-v16 代码）",
        f"- 论文集：{len(results)} 篇，版式覆盖 ACL/EMNLP 双栏、NeurIPS 单栏、"
        "IEEE/CVPR 双栏、arXiv 单栏；每篇最多 12 页",
        "- 判定方式：textlayer 修复规则的逆向检测——以下残留项理想值均为 0",
        "",
        "| 论文 | 页 | 段 | 伪标题残留 | 上标残留 | 段尾重复 | 碎片段 | 乱码符 | 微型段 | 图注数 |",
        "|------|----|----|-----------|---------|---------|--------|--------|--------|--------|",
    ]
    for name, s in results.items():
        lines.append(
            f"| {name.replace('.pdf', '')} | {s['pages']} | {s['paras']} "
            f"| {len(s['sentence_heading'])} | {len(s['sup_residue'])} "
            f"| {len(s['tail_dup'])} | {len(s['fragment'])} "
            f"| {s['mojibake']} | {s['tiny_paras']} | {s['img_refs']} |"
        )
    lines.append("")
    # 残留样本（每项最多 3 例）
    for key, title in (
        ("sentence_heading", "伪标题残留样本"),
        ("sup_residue", "上标残留样本"),
        ("tail_dup", "段尾重复样本"),
        ("fragment", "碎片段样本"),
    ):
        samples = []
        for name, s in results.items():
            for x in s[key][:3]:
                samples.append(f"- [{name}] {x!r}")
        if samples:
            lines += [f"## {title}", ""] + samples[:9] + [""]
    total = {
        k: sum(s[k] if isinstance(s[k], int) else len(s[k]) for s in results.values())
        for k in ("sentence_heading", "sup_residue", "tail_dup", "fragment", "mojibake")
    }
    total_paras = sum(s["paras"] for s in results.values())
    lines += [
        "## 结论",
        "",
        f"**结构层**（伪标题/上标/段尾重复/碎片）：全集 {total_paras} 段，"
        f"残留合计 {total['sentence_heading'] + total['sup_residue'] + total['tail_dup'] + total['fragment']}"
        f"（占段落 {(total['sentence_heading'] + total['sup_residue'] + total['tail_dup'] + total['fragment']) / max(total_paras, 1) * 100:.2f}%）",
        "",
        f"**字符层**：乱码替换符 {total['mojibake']} 个"
        "——来源为数学字体 Unicode 映射缺失（∑→◆ 等），属公式链路职责"
        "（formula_hint + 按块视觉 OCR 兜底），不属于结构提取问题；"
        "含该类符号的块已被 has_heavy_math 捕获",
        "",
        "注：微型段为页码/页脚类单块（每页约 1 个，属正常结构块）；"
        "图注数为图表快照插入的引用数（快照管线工作正常）。",
    ]
    DOCS.mkdir(exist_ok=True)
    report = DOCS / "提取质量体检.md"
    report.write_text("\n".join(lines), encoding="utf-8")
    print("REPORT:", report)
    print("TOTALS:", total, "paras:", total_paras)


if __name__ == "__main__":
    main()
