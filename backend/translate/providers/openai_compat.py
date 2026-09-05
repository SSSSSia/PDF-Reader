import re

import httpx
from .base import BaseTranslator

# OpenAI 兼容协议实现：SiliconFlow 与 OpenAI 都提供标准的 /chat/completions，
# 仅 base_url / model 不同，因此共用同一套实现（决策 D3）。

# 语言代码 -> 自然语言名称。旧实现把 "zh"/"en" 代码直接拼进中文提示词
# （"翻译为zh"），模型理解偏差导致质量差（实测问题），故显式映射。
_LANG_NAMES = {
    "zh": "中文",
    "en": "英文",
    "ja": "日文",
    "ko": "韩文",
    "fr": "法文",
    "de": "德文",
}


def _lang_name(code: str, fallback: str) -> str:
    return _LANG_NAMES.get((code or "").lower().strip(), fallback)


def _system_prompt(source_lang: str, target_lang: str) -> str:
    src = _lang_name(source_lang, "源")
    tgt = _lang_name(target_lang, "目标")
    return (
        f"你是一位专业的学术文献翻译助手。请将以下{src}内容准确地翻译为{tgt}。"
        "要求："
        "1) 术语翻译准确，符合学术惯例，专业名词首次出现可附原文；"
        "2) 严格保留原文的 Markdown 结构（标题、列表、表格、公式、代码块等），"
        "标记符号本身保持原样不翻译；"
        "3) 只输出译文正文，不要输出任何解释、注释或前后缀。"
    )


# ── 批量合并翻译（修复"翻译速度极慢"）────────────────────────────────
# 逐块单发时，一篇论文上百个段落 = 上百次 HTTP 请求，串行排队极慢。
# 将多个段落合并为一次请求（分隔标记 <<<n>>>），请求数减少约 6 倍。
# 模型解析失败或段数不匹配时，自动回退为逐条翻译，保证不丢内容。
CHUNK_SIZE = 10
_SEG_SPLIT = re.compile(r"<<<(\d+)>>>")


class OpenAICompatProvider(BaseTranslator):
    name = "openai_compat"
    available = True

    async def translate(
        self, text: str, source_lang: str, target_lang: str, config: dict
    ) -> str:
        api_key = config.get("api_key", "")
        api_url = config.get("api_url", "https://api.siliconflow.cn/v1")
        model = config.get("model", "deepseek-ai/DeepSeek-V4-Flash")

        if not api_key:
            return ""

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": _system_prompt(source_lang, target_lang)},
                {"role": "user", "content": text},
            ],
            "max_tokens": 8192,
            "temperature": 0.2,
        }
        # Qwen3 系列是混合思考模型：默认先思考再翻译（实测 22.5s vs 2.3s，慢 10 倍），
        # 且思考内容消耗同一 max_tokens 预算。翻译任务关闭思考。
        if "qwen3" in model.lower():
            payload["enable_thinking"] = False
        headers = {"Authorization": f"Bearer {api_key}"}

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{api_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=120,
            )
            if resp.status_code != 200:
                # 保留响应体，4xx 的具体原因（模型名/参数错误）都在 body 里
                raise RuntimeError(
                    f"翻译请求失败 HTTP {resp.status_code}: {resp.text[:300]}"
                )
            data = resp.json()

        return data["choices"][0]["message"]["content"].strip()

    async def translate_batch(
        self, texts: list, source_lang: str, target_lang: str, config: dict
    ) -> list:
        results: list[str] = []
        for start in range(0, len(texts), CHUNK_SIZE):
            chunk = list(texts[start : start + CHUNK_SIZE])
            if len(chunk) == 1:
                results.append(
                    await self.translate(chunk[0], source_lang, target_lang, config)
                )
                continue
            merged = "\n".join(
                f"<<<{i}>>>\n{t}" for i, t in enumerate(chunk)
            )
            try:
                out = await self.translate(merged, source_lang, target_lang, config)
                segs = _SEG_SPLIT.split(out)
                # segs 形如 [前缀(空), idx, 文本, idx, 文本, ...]
                parsed: dict[int, str] = {}
                for j in range(1, len(segs) - 1, 2):
                    parsed[int(segs[j])] = segs[j + 1].strip()
                # 第 0 段可能紧跟前缀（模型没回显 <<<0>>> 标记）
                if 0 not in parsed and segs and segs[0].strip():
                    parsed[0] = segs[0].strip()
                if all(i in parsed for i in range(len(chunk))):
                    results.extend(parsed[i] for i in range(len(chunk)))
                    continue
                raise ValueError("段数不匹配")
            except Exception:
                # 合并失败：逐条回退，宁可慢不可丢
                for t in chunk:
                    try:
                        results.append(
                            await self.translate(t, source_lang, target_lang, config)
                        )
                    except Exception:
                        results.append("")
        return results
