from translate.providers import get_provider

# 分发器：根据 config.provider 选用对应实现（决策 D3）。
# 具体协议实现见 translate/providers/，单一职责、便于扩展与测试。


async def translate_text(
    text: str,
    source_lang: str,
    target_lang: str,
    config: dict,
) -> str:
    if not text or not text.strip():
        return ""
    provider_name = config.get("provider", "siliconflow")
    provider = get_provider(provider_name)
    return await provider.translate(text, source_lang, target_lang, config)


async def translate_batch(
    texts: list,
    source_lang: str,
    target_lang: str,
    config: dict,
) -> list:
    provider_name = config.get("provider", "siliconflow")
    provider = get_provider(provider_name)
    return await provider.translate_batch(texts, source_lang, target_lang, config)
