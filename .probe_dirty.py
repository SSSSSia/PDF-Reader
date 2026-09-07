import sys, os, re, json
sys.path.insert(0, os.path.abspath('backend'))
from cache.file_cache import file_hash, ocr_key, _cache_path

C = r'C:/Users/Administrator/AppData/Roaming/pdf-reader/cache'
pats = {}
examples = {}

def bump(k, n=1):
    pats[k] = pats.get(k, 0) + n

def sample(k, s):
    examples.setdefault(k, s)

# 全缓存扫描（键是哈希，按内容特征分类）
n_files = 0
import glob
for p in glob.glob(os.path.join(C, '*', '*.json')):
    try:
        d = json.load(open(p, encoding='utf-8'))
    except Exception:
        continue
    for blk in d.get('blocks', []):
        txt = blk.get('original') or ''
        if len(txt) < 20:
            continue
        n_files += 1
        for m in re.finditer(r'_{2,}', txt):
            ctx = txt[max(0, m.start() - 40):m.end() + 40].replace('\n', '|')
            bump('下划线>=2')
            sample('下划线>=2', ctx)
        for m in re.finditer(r'\\\((.{1,60}?)\\\)', txt):
            bump('行内公式 \\( \\)')
            sample('行内公式 \\( \\)', m.group(0)[:70])
        for m in re.finditer(r'\\\[(.{1,80}?)\\\]', txt, re.S):
            bump('块公式 \\[ \\]')
            sample('块公式 \\[ \\]', m.group(0)[:70])
        if re.search(r'\\(frac|alpha|beta|gamma|sum|int|mathbb|mathrm|text)\b', txt):
            bump('latex宏')
            m = re.search(r'.{0,30}\\(?:frac|alpha|beta|gamma|sum|int|mathbb|mathrm|text)\b.{0,40}', txt)
            sample('latex宏', m.group(0) if m else '')
        for m in re.finditer(r'\$\$(.+?)\$\$', txt, re.S):
            bump('$$公式')
            sample('$$公式', m.group(0)[:70])
        # 上标/下标 Unicode 残留（公式转坏的典型）
        if re.search(r'[⁰¹²³⁴⁵⁶⁷⁸⁹ⁱⁿ⁺⁻₀₁₂₃₄₅₆₇₈₉₊₋]', txt):
            bump('上下标Unicode')
            m = re.search(r'.{0,35}[⁰¹²³⁴⁵⁶⁷⁸⁹ⁱⁿ⁺⁻₀₁₂₃₄₅₆₇₈₉₊₋].{0,35}', txt)
            sample('上下标Unicode', m.group(0).replace('\n', '|') if m else '')
        for m in re.finditer(r'^\s*(\d{1,3})\s*$', txt, re.M):
            bump('孤立数字行')
        for tag in re.finditer(r'</?(sub|sup|u|span|div)[^>]*>', txt):
            bump('HTML标签 ' + tag.group(1))
            sample('HTML标签', txt[max(0, tag.start() - 30):tag.end() + 30].replace('\n', '|'))

print('扫描块数:', n_files)

for k, v in sorted(pats.items(), key=lambda x: -x[1]):
    print(f'{k}: {v}')
print('--- 样例:')
for k, v in examples.items():
    print(f'[{k}]', v[:110])
