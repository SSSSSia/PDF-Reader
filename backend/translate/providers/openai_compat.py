import httpx
from .base import BaseTranslator

# OpenAI 兼容协议实现：SiliconFlow 与 OpenAI 都提供标准的 /chat/completions，
# 仅 base_url / model 不同，因此共用同一套实现（决策 D3）。
SYSTEM_PROMPT = (
    "你是一个翻译助手。将以下文本翻译为目标语言，"
    "保持原文格式和段落结构，并严格保留 markdown 标记"
    "（标题、列表、表格、代码块等）。"
)


class OpenAICompatProvider(BaseTranslator):
    name = "openai_compat"
    available = True

    async def translate(
        self, text: str, source_lang: str, target_lang: str, config: dict
    ) -> str:
        api_key = config.get("api_key", "")
        api_url = config.get("api_url", "https://api.siliconflow.cn/v1")
        model = config.get("model", "Qwen2.5-7B-Instruct")

        if not api_key:
            return ""

        system_prompt = SYSTEM_PROMPT.replace(
            "目标语言", target_lang
        ).replace("文本", f"{source_lang}文本")

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            "max_tokens": 4096,
            "temperature": 0.3,
        }
        headers = {"Authorization": f"Bearer {api_key}"}

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{api_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()

        return data["choices"][0]["message"]["content"].strip()
