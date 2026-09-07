# -*- coding: utf-8 -*-
"""S1 Spike v2：bbox↔段落对应率（排除快照区域，块级锚点 + 段级聚类双口径）。"""
import sys, os, tempfile, time, re

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

import pymupdf
from ocr.textlayer import extract_pages, _snapshot_figures
from ocr.siliconflow import split_into_blocks, _NOISE_BLOCK, _RUNNING_HEAD, _FOOTER_PAT, _FOOTER_MAX_CHARS
from pipeline.processor import _merge_cross_page

PAPERS_DIR = r"D:\论文\graphrag"
CASES = [("DALK.pdf", [2, 3, 4]), ("TOG.pdf", [2, 3, 4]), ("HippoRAG.pdf", [2, 3, 4])]

def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", (s or "").lower())

def is_noise(b: str) -> bool:
    b = b.strip()
    return (
        not b
        or _NOISE_BLOCK.match(re.sub(r"\s+", "", b))
        or (len(b) < 60 and _RUNNING_HEAD.match(b))
        or (len(b) < _FOOTER_MAX_CHARS and _FOOTER_PAT.search(b))
    )

def classify_two_col(page) -> bool:
    blocks = [b for b in page.get_text("blocks") if (b[4] or "").strip()]
    if len(blocks) < 6:
        return False
    pw = page.rect.width
    lefts = [b for b in blocks if b[2] < 0.58 * pw]
    rights = [b for b in blocks if b[0] > 0.42 * pw]
    both = [b for b in blocks if (b[2] - b[0]) > 0.7 * pw]
    return len(lefts) >= 3 and len(rights) >= 3 and len(both) <= 2

def run_paper(name, page_nums):
    path = os.path.join(PAPERS_DIR, name)
    t0 = time.time()
    img_dir = tempfile.mkdtemp(prefix="s1v2_")
    mds = extract_pages(path, page_nums=page_nums, image_dir=img_dir)
    struct = []
    for pno, md in zip(page_nums, mds):
        blocks = split_into_blocks(md or "")
        struct.append({"page": pno, "blocks": [{"original": b} for b in blocks]})
    merged = _merge_cross_page(struct)
    md_norms = [norm(b["original"]) for pg in merged for b in pg["blocks"]]

    doc = pymupdf.open(path)
    stats = {"raw_total": 0, "contained": 0, "split": 0, "unmatched": 0,
             "in_fig": 0, "para_total": 0, "para_contained": 0, "para_split": 0}
    for pno in page_nums:
        page = doc[pno]
        two = classify_two_col(page)
        pw = page.rect.width
        _, regions = _snapshot_figures(doc, pno, img_dir)
        def in_fig(r):
            return any(r.intersects(rg) and (r & rg).get_area() > 0.5 * max(r.get_area(), 1) for rg in regions)

        # 原始块（滤噪、排除快照区域）
        raw = []
        for b in page.get_text("blocks"):
            t = (b[4] or "").strip()
            if not t or is_noise(t):
                continue
            r = pymupdf.Rect(b[:4])
            if in_fig(r):
                stats["in_fig"] += 1
                continue
            raw.append((r, t))
        # 段级聚类：同列 + 垂直间隙 < 6pt（近似同段行距）
        clusters = []
        if two:
            cols = {0: [], 1: []}
            for r, t in raw:
                cols[0 if (r[0] + r[2]) / 2 < pw * 0.52 else 1].append((r, t))
            groups = cols.values()
        else:
            groups = [sorted(raw, key=lambda x: x[0].y0)]
        for g in groups:
            g = sorted(g, key=lambda x: x[0].y0)
            cur = None
            for r, t in g:
                if cur and r.y0 - cur[0].y1 < 6:
                    cur[0] |= r
                    cur[1].append(t)
                else:
                    if cur:
                        clusters.append(cur)
                    cur = [pymupdf.Rect(r), [t]]
            if cur:
                clusters.append(cur)

        def match(cn):
            if not cn:
                return "?"
            if any(cn in mn for mn in md_norms):
                return "contained"
            half = cn[: max(len(cn) // 2, 20)]
            tail = cn[-max(len(cn) // 2, 20):]
            if any(half in mn or tail in mn for mn in md_norms):
                return "split"
            return "unmatched"

        for r, t in raw:
            stats["raw_total"] += 1
            m = match(norm(t))
            if m == "contained":
                stats["contained"] += 1
            elif m == "split":
                stats["split"] += 1
            else:
                stats["unmatched"] += 1
        for r, ts in clusters:
            stats["para_total"] += 1
            m = match(norm(" ".join(ts)))
            if m == "contained":
                stats["para_contained"] += 1
            elif m == "split":
                stats["para_split"] += 1
    doc.close()
    elapsed = time.time() - t0
    rt, ct, st, um = stats["raw_total"], stats["contained"], stats["split"], stats["unmatched"]
    pt, pc, ps = stats["para_total"], stats["para_contained"], stats["para_split"]
    print(f"\n===== {name} pages={page_nums} =====")
    print(f"  快照区域内块(不算分母): {stats['in_fig']}")
    print(f"  [块级锚点] 总 {rt}: contained {ct} ({ct/max(rt,1)*100:.0f}%)  split {st} ({st/max(rt,1)*100:.0f}%)  unmatched {um} ({um/max(rt,1)*100:.0f}%)")
    print(f"  [段级聚类] 总 {pt}: contained {pc} ({pc/max(pt,1)*100:.0f}%)  split {ps} ({ps/max(pt,1)*100:.0f}%)  unmatched {pt-pc-ps} ({(pt-pc-ps)/max(pt,1)*100:.0f}%)")
    print(f"  耗时 {elapsed:.1f}s")
    return stats

totals = {"raw_total": 0, "contained": 0, "split": 0, "unmatched": 0, "in_fig": 0}
for name, pages in CASES:
    s = run_paper(name, pages)
    for k in totals:
        totals[k] += s.get(k, 0)
rt, ct, st, um = totals["raw_total"], totals["contained"], totals["split"], totals["unmatched"]
print(f"\n===== 三篇汇总（块级锚点）=====")
print(f"总 {rt}: contained {ct} ({ct/max(rt,1)*100:.0f}%)  split {st} ({st/max(rt,1)*100:.0f}%)  unmatched {um} ({um/max(rt,1)*100:.0f}%)")
