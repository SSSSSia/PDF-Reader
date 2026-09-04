from .base import BaseTranslator


class GoogleProvider(BaseTranslator):
    name = "google"
    available = False

    async def translate(
        self, text: str, source_lang: str, target_lang: str, config: dict
    ) -> str:
        raise NotImplementedError(
            "Google Translate 适配器尚未实现（即将支持）。请在设置中选择 "
            "SiliconFlow 或 OpenAI。"
        )
