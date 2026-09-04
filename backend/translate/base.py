import httpx
from config import settings

async def translate_text(
    text: str,
    source_lang: str,
    target_lang: str,
    config: dict,
) -> str:
    provider = config.get("provider", "siliconflow")
    api_key = config.get("api_key", "")
    api_url = config.get("api_url", "https://api.siliconflow.cn/v1")
    model = config.get("model", "Qwen2.5-7B-Instruct")

    if not api_key:
        return ""

    system_prompt = (
        f"你是一个翻译助手。将以下{source_lang}文本翻译为{target_lang}，"
        f"保持原文格式和段落结构，并严格保留 markdown 标记（标题、列表、表格、代码块等）。"
    )

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

async def translate_batch(
    texts: list[str],
    source_lang: str,
    target_lang: str,
    config: dict,
) -> list[str]:
    results = []
    for text in texts:
        if not text.strip():
            results.append("")
            continue
        translated = await translate_text(text, source_lang, target_lang, config)
        results.append(translated)
    return results
