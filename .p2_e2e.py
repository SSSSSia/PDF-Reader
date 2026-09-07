import sys, os, asyncio, re
sys.path.insert(0, os.path.abspath('backend'))
import config
from ocr.textlayer import extract_pages
from ocr.siliconflow import split_into_blocks
from pipeline.processor import _split_page, _merge_cross_page, _PURE_IMAGE
from translate import sanitize
from translate.base import translate_batch
from translate.providers.openai_compat import PROMPT_VERSION
from cache.file_cache import translate_key, read_cache

PDF = 'D:/论文/graphrag/TOG.pdf'
PAGES = [0, 1, 2]

async def main():
    await config.settings.init()
    settings = config.settings
    t_cfg = dict(settings.translate_config)
    target_lang = t_cfg.get('target_language', 'zh')
    source_lang = t_cfg.get('source_language', 'en')
    model = t_cfg.get('model', '')
    print(f'配置: model={model} target={target_lang}', flush=True)

    # 1) 提取（v9，含 <u> 清理）
    outdir = os.path.join(settings.cache_dir, 'images', 'p2test000000001')
    os.makedirs(outdir, exist_ok=True)
    mds = extract_pages(PDF, PAGES, image_dir=outdir)
    pages = []
    for i, md in zip(PAGES, mds):
        pages.append({'page': i, 'blocks': [{'block_id': 0, 'page': i, 'original': md or '', 'translated': '', 'position': {}}]})
    pages = [_split_page(p) for p in pages]

    # 2) <u> 残留检查
    u_left = sum(1 for p in pages for b in p['blocks'] if '<u>' in b['original'])
    print(f'<u> 残留块数: {u_left}', flush=True)

    # 3) 跨页合并
    pages = _merge_cross_page(pages)

    # 4) 术语表
    from translate.glossary import build_glossary
    glossary = await build_glossary(pages, t_cfg, settings.cache_dir, 'p2testhash')
    if glossary:
        t_cfg['glossary'] = glossary
        print('术语表样例:', dict(list(glossary.items())[:5]), flush=True)

    # 5) 收集并翻译（走公式保护）
    texts, keys = [], []
    for p in pages:
        for b in p['blocks']:
            o = (b.get('original') or '').strip()
            if not o or _PURE_IMAGE.match(o) or sanitize.is_formula_block(o):
                continue
            texts.append(o)
            keys.append(b)
    print(f'待翻块数: {len(texts)}，公式块已跳过', flush=True)
    protected = [sanitize.protect_math(t) for t in texts[:6]]
    outs = await translate_batch([p for p, _ in protected], source_lang, target_lang, t_cfg)
    for (p, restore), o in zip(protected, outs):
        restored = restore(o or '')
        has_ph = '[[' in restored
        print(f'--- 原文({len(p)}字): {p[:60].replace(chr(10)," ")}')
        print(f'    译文: {restored[:80].replace(chr(10)," ")} | 占位符残留: {has_ph}', flush=True)

asyncio.run(main())
