from .base import BaseTranslator


class DeepLProvider(BaseTranslator):
    name = "deepl"
    available = False

    async def translate(
        self, text: str, source_lang: str, target_lang: str, config: dict
    ) -> str:
        raise NotImplementedError(
            "DeepL 适配器尚未实现（即将支持）。请在设置中选择 "
            "SiliconFlow 或 OpenAI。"
        )
