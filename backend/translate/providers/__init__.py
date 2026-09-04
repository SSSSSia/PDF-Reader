from .base import BaseTranslator
from .openai_compat import OpenAICompatProvider
from .google import GoogleProvider
from .deepl import DeepLProvider

# ── Provider 注册表（决策 D3）──────────────────────────────────────────────
# SiliconFlow 与 OpenAI 都走 OpenAI 兼容的 /chat/completions，共用一套实现；
# Google / DeepL 为独立适配器，暂未实现（前端已在 UI 中禁用，禁止静默失败）。
REGISTRY: dict[str, type[BaseTranslator]] = {
    "siliconflow": OpenAICompatProvider,
    "openai": OpenAICompatProvider,
    "google": GoogleProvider,
    "deepl": DeepLProvider,
}


def get_provider(name: str) -> BaseTranslator:
    cls = REGISTRY.get(name)
    if cls is None:
        raise ValueError(f"未知的翻译 provider: {name}")
    return cls()


def list_providers() -> dict:
    """返回 {provider 名称: 是否已在后端实现}，供前端/接口自查。"""
    return {name: cls.available for name, cls in REGISTRY.items()}
