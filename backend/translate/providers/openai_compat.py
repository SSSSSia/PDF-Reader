import re

import httpx
from .base import BaseTranslator

# OpenAI 兼容协议实现：SiliconFlow 与 OpenAI 都提供标准的 /chat/completions，
# 仅 base_url / model 不同，因此共用同一套实现（决策 D3）。

# 提示词/翻译参数版本号（阶段2-T2）：提示词内容、temperature、占位符协议等
# 影响译文产出的变更必须 +1，使旧翻译缓存整体失效（与 OCR 侧 TEXT_LAYER_MODEL 做法对齐）。
# v1（隐含）：初始提示词。
# v2：阶段2——系统提示词注入论文标题+术语表（两遍法）、新增 [[M<n>]] 公式占位符协议。
PROMPT_VERSION = "pv2"

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

# 术语表条数上限（token 预算控制，见阶段2文档 §5）
_GLOSSARY_MAX = 30


def _lang_name(code: str, fallback: str) -> str:
    return _LANG_NAMES.get((code or "").lower().strip(), fallback)


def _system_prompt(source_lang: str, target_lang: str, config: dict | None = None) -> str:
    src = _lang_name(source_lang, "源")
    tgt = _lang_name(target_lang, "目标")
    parts: list[str] = []
    # 论文标题前置（两遍法：让模型带着主题语境翻译，代词/缩写指代更准）
    title = (config or {}).get("doc_title")
    if title:
        parts.append(f"论文标题：{title}")
    body = (
        f"你是一位专业的学术文献翻译助手。请将以下{src}内容准确地翻译为{tgt}。"
        "要求："
        "1) 术语翻译准确，符合学术惯例，专业名词首次出现可附原文；"
        "2) 严格保留原文的 Markdown 结构（标题、列表、表格、公式、代码块等），"
        "标记符号本身保持原样不翻译；"
        "3) 文本中形如 [[M0]]、[[F1]] 的双方括号占位符是数学公式或符号，"
        "必须原样保留，不要翻译、改写、增删或移动；"
        "4) 只输出译文正文，不要输出任何解释、注释或前后缀。"
    )
    parts.append(body)
    glossary = (config or {}).get("glossary")
    if isinstance(glossary, dict) and glossary:
        lines = [
            f"- {k} → {v}"
            for k, v in list(glossary.items())[:_GLOSSARY_MAX]
        ]
        parts.append("术语表（以下术语必须按给定译法翻译，全文保持一致）：\n" + "\n".join(lines))
    return "\n\n".join(parts)


# ── 批量合并翻译（修复"翻译速度极慢"）────────────────────────────────
# 逐块单发时，一篇论文上百个段落 = 上百次 HTTP 请求，串行排队极慢。
# 将多个段落合并为一次请求（分隔标记 <<<n>>>），请求数减少约 6 倍。
# 模型解析失败或段数不匹配时，自动减半重试（阶段2-T1：10→5→2→1），
# 单段仍失败才落空并记日志——旧实现直接串行回退，慢且无感知。
CHUNK_SIZE = 10
_SEG_SPLIT = re.compile(r"<<<(\d+)>>>")


def parse_segments(out: str, expected: int) -> dict[int, str]:
    """解析合并翻译输出，返回 {段索引: 译文}。缺段时由调用方判定失败。"""
    segs = _SEG_SPLIT.split(out)
    # segs 形如 [前缀(空), idx, 文本, idx, 文本, ...]
    parsed: dict[int, str] = {}
    for j in range(1, len(segs) - 1, 2):
        try:
            parsed[int(segs[j])] = segs[j + 1].strip()
        except ValueError:
            continue
    # 第 0 段可能紧跟前缀（模型没回显 <<<0>>> 标记）
    if 0 not in parsed and segs and segs[0].strip():
        parsed[0] = segs[0].strip()
    return parsed


# ── 连接复用（阶段1-T3）──────────────────────────────────────────────
# 旧实现每次 translate() 都新建 httpx.AsyncClient——一篇论文 40+ 批次请求
# 就是 40+ 次 TCP+TLS 握手（每次约 200–400ms 纯浪费）。改为模块级懒加载
# 单例。uvicorn 单事件循环下安全；客户端关闭（如测试隔离）后自动重建。
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=120)
    return _client


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
                {
                    "role": "system",
                    # 允许调用方覆盖提示词（表格单元格等特殊场景用专用提示）
                    "content": config.get("system_prompt")
                    or _system_prompt(source_lang, target_lang, config),
                },
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

        # 阶段1-T3：复用模块级连接，避免每次请求重建 TCP+TLS
        resp = await _get_client().post(
            f"{api_url}/chat/completions",
            json=payload,
            headers=headers,
        )
        if resp.status_code != 200:
            # 保留响应体，4xx 的具体原因（模型名/参数错误）都在 body 里
            raise RuntimeError(
                f"翻译请求失败 HTTP {resp.status_code}: {resp.text[:300]}"
            )
        data = resp.json()

        # 阶段2-T1：finish_reason=length 说明输出被 max_tokens 截断。
        # 合并批次截断 → 段数不匹配 → 旧版静默降级；单段截断 → 译文缺尾。
        # 都必须显式失败，让上层走减半重试，绝不静默吞掉。
        reason = (data.get("choices") or [{}])[0].get("finish_reason")
        if reason == "length":
            raise RuntimeError("输出截断 (finish_reason=length)")

        return data["choices"][0]["message"]["content"].strip()

    async def translate_batch(
        self, texts: list, source_lang: str, target_lang: str, config: dict
    ) -> list:
        results: list[str] = []
        for start in range(0, len(texts), CHUNK_SIZE):
            chunk = list(texts[start : start + CHUNK_SIZE])
            results.extend(
                await self._translate_chunk(chunk, source_lang, target_lang, config)
            )
        return results

    async def _translate_chunk(
        self, chunk: list, source_lang: str, target_lang: str, config: dict
    ) -> list[str]:
        """翻译一个 chunk。失败时减半重试（阶段2-T1），单段失败才落空。"""
        if len(chunk) == 1:
            try:
                return [await self.translate(chunk[0], source_lang, target_lang, config)]
            except Exception as e:
                print(f"[translate] 单段翻译失败: {e}")
                return [""]

        merged = "\n".join(f"<<<{i}>>>\n{t}" for i, t in enumerate(chunk))
        try:
            out = await self.translate(merged, source_lang, target_lang, config)
            parsed = parse_segments(out, len(chunk))
            if all(i in parsed for i in range(len(chunk))):
                return [parsed[i] for i in range(len(chunk))]
            raise ValueError("段数不匹配")
        except Exception as e:
            # 减半重试：宁可多几次请求，也不串行慢速回退或丢段
            half = len(chunk) // 2
            print(f"[translate] 批次截断/失败，减半重试 chunk={len(chunk)}→{half}+{len(chunk) - half}: {e}")
            first = await self._translate_chunk(
                chunk[:half], source_lang, target_lang, config
            )
            second = await self._translate_chunk(
                chunk[half:], source_lang, target_lang, config
            )
            return first + second
