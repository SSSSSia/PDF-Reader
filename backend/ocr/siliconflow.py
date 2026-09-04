import asyncio
import base64
import re
import httpx
import pymupdf

# PyMuPDF 在 1.24+ 将 `import fitz` 标记为弃用，统一用 `import pymupdf` 并别名，
# 后续所有 fitz.* 调用保持不变。它单 pip 包、跨平台、无外部依赖，用于 PDF → 每页 PNG。
fitz = pymupdf

# PaddleOCR-VL 在 SiliconFlow 上通过标准 OpenAI 兼容接口提供，
# 仅接受「图片」+ 自然语言指令（"OCR:" 即触发版面解析）。
# 注意：SiliconFlow 云 API 没有 /generate 端点，旧实现调不通（见《开发总纲》第 11 章）。
OCR_PROMPT = "OCR:"
DEFAULT_MODEL = "PaddlePaddle/PaddleOCR-VL-1.5"

# PDF 渲染分辨率（矩阵缩放系数），过低识别率下降、过高 token 成本高
RENDER_SCALE = 1.8
# OCR 并发上限，免费额度下保守取值
OCR_CONCURRENCY = 3


async def call_ocr(file_path: str, config: dict) -> list:
    api_url = config.get("api_url", "https://api.siliconflow.cn/v1")
    api_key = config.get("api_key", "")
    model = config.get("model", DEFAULT_MODEL)

    if not api_key:
        raise ValueError("OCR API Key 未配置")

    # 1) PDF → 每页 PNG（内存中，不落盘）。fitz 是阻塞 IO，放到线程避免卡事件循环。
    page_images = await asyncio.to_thread(_pdf_to_page_images, file_path)
    if not page_images:
        raise ValueError("PDF 未解析出任何页面")

    # 2) 逐页 OCR（受限并发）
    sem = asyncio.Semaphore(OCR_CONCURRENCY)

    async def ocr_one(idx: int, img_bytes: bytes) -> dict:
        async with sem:
            markdown = await _ocr_image(img_bytes, api_url, api_key, model)
            return {
                "page": idx,
                "blocks": [
                    {
                        "block_id": 0,
                        "page": idx,
                        "original": markdown or "",
                        "translated": "",
                        "position": {"y_start": 0, "y_end": 0},
                    }
                ],
            }

    results = await asyncio.gather(*[ocr_one(i, b) for i, b in enumerate(page_images)])
    return list(results)


def _pdf_to_page_images(file_path: str) -> list[bytes]:
    doc = fitz.open(file_path)
    try:
        out = []
        mat = fitz.Matrix(RENDER_SCALE, RENDER_SCALE)
        for page in doc:
            pix = page.get_pixmap(matrix=mat)
            out.append(pix.tobytes("png"))
        return out
    finally:
        doc.close()


async def _ocr_image(img_bytes: bytes, api_url: str, api_key: str, model: str) -> str:
    b64 = base64.b64encode(img_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{b64}"

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                    {"type": "text", "text": OCR_PROMPT},
                ],
            }
        ],
        "max_tokens": 8192,
        "temperature": 0.01,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{api_url}/chat/completions",
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    return data["choices"][0]["message"]["content"].strip()


# ── 段/句级切块（用户决策：对照按段/句切分块）──────────────────────────
# OCR 返回的是「整页 markdown 一块」；在翻译前切成段/句级 block，
# 既贴合双语逐块对照，又让译文缓存更细粒度。切块与 OCR 缓存解耦：
# OCR 缓存始终存整页块，切块在缓存读取之后进行，因此改切块策略不影响命中。
_SENT_SPLIT = re.compile(r"(?<=[。.!?！？；;\n])")


def split_into_blocks(text: str) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    parts: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= 300:
            parts.append(para)
            continue
        for s in _SENT_SPLIT.split(para):
            s = s.strip()
            if s:
                parts.append(s)
    return parts
