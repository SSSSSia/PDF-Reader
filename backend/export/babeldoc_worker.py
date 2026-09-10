"""BabelDOC 导出 worker（阶段9-T1）。

在 .venv-babeldoc 的 Python 里运行（BabelDOC 依赖隔离，不污染主后端环境），
直接调用 BabelDOC Python API（async_translate）而非 CLI 子进程——
原因：CLI 进度走 rich 渲染无法稳定解析；Python API 的 async_translate
逐事件产出 overall_progress(0-100)，天然适合 JSON 行协议上报。

stdout 协议（每行一个 JSON，供主后端逐行读取）：
  {"type": "ready"}                                    启动成功（模型加载完毕）
  {"type": "progress", "stage": "...", "overall": 42}  总进度 0-100
  {"type": "finish", "dual": "...", "mono": "..."}     成功，产物绝对路径
  {"type": "error", "error": "..."}                    失败
诊断/日志一律走 stderr，保证 stdout 纯净。

API key 仅经 argv 传入本进程（BabelDOC 不支持环境变量读取），
主后端负责不把它写进任何日志。
"""

import argparse
import asyncio
import json
import os
import sys
import time


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="源 PDF 绝对路径")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--qps", type=int, default=2)
    parser.add_argument("--lang-in", default="en")
    parser.add_argument("--lang-out", default="zh")
    args = parser.parse_args()

    # BabelDOC 的 import 在隔离进程内完成，无所谓启动耗时
    from babeldoc.docvision.doclayout import DocLayoutModel
    from babeldoc.format.pdf.high_level import async_translate
    from babeldoc.format.pdf.translation_config import (
        TranslationConfig,
        WatermarkOutputMode,
    )
    from babeldoc.translator.translator import OpenAITranslator

    translator = OpenAITranslator(
        lang_in=args.lang_in,
        lang_out=args.lang_out,
        model=args.model,
        base_url=args.base_url,
        api_key=args.api_key,
    )

    doc_layout_model = DocLayoutModel.load_onnx()
    config = TranslationConfig(
        translator=translator,
        input_file=args.input,
        lang_in=args.lang_in,
        lang_out=args.lang_out,
        doc_layout_model=doc_layout_model,
        output_dir=args.output_dir,
        qps=args.qps,
        use_rich_pbar=False,           # tqdm/rich 都不需要，进度走事件流
        auto_extract_glossary=False,   # T0 决策：省 token，术语表后续增强
        watermark_output_mode=WatermarkOutputMode.NoWatermark,
        # 与 T0 实测一致：Qwen3-8B 关闭思考链，避免 <think> 污染译文
        custom_system_prompt=(
            "/no_think You are a professional academic paper translator. "
            "Translate the input English text into Simplified Chinese. "
            "Keep formulas, citations, references and proper nouns unchanged. "
            "Output only the translation."
        ),
    )

    _emit({"type": "ready"})

    # ---- 事件消费 + 产物看门狗双轨 ----
    # 实测（2026-09-10）：BabelDOC 0.6.4 以 Python API 调用时，产物落盘后
    # "finish" 事件可能永不到来（finished_callback 未触发，async-for 挂死在
    # 99% Save PDF）——CLI 路径（T0）无此问题。故不能只等事件：并行跑一个
    # 看门狗，轮询输出目录，*.dual.pdf 出现且大小稳定即判定成功，主动收尾。
    # 收尾用 os._exit：绕开 BabelDOC 残留的非守护线程导致解释器无法退出。
    result: dict | None = None
    error_msg: str | None = None

    async def _consume() -> None:
        nonlocal result, error_msg
        async for event in async_translate(config):
            etype = event.get("type")
            if etype in ("progress_start", "progress_update", "progress_end"):
                _emit({
                    "type": "progress",
                    "stage": str(event.get("stage", "")),
                    "overall": float(event.get("overall_progress", 0) or 0),
                })
            elif etype == "finish":
                tr = event.get("translate_result")
                if tr is not None:
                    dual = getattr(tr, "no_watermark_dual_pdf_path", None) or getattr(
                        tr, "dual_pdf_path", None
                    )
                    mono = getattr(tr, "no_watermark_mono_pdf_path", None) or getattr(
                        tr, "mono_pdf_path", None
                    )
                    result = {"dual": str(dual or ""), "mono": str(mono or "")}
            elif etype == "error":
                error_msg = str(event.get("error", "unknown"))
            if error_msg:
                return

    consume_task = asyncio.ensure_future(_consume())

    def _find_dual() -> str | None:
        if not os.path.isdir(args.output_dir):
            return None
        for name in os.listdir(args.output_dir):
            if name.endswith(".dual.pdf"):
                return os.path.join(args.output_dir, name)
        return None

    DUAL_STABLE_SECS = 4.0   # 大小连续两次采样一致且文件 mtime 距今超过该值
    HARD_TIMEOUT_SECS = 4 * 3600
    poll_gap = 3.0
    last_size = -1
    stable_since: float | None = None
    dual_path: str | None = None
    deadline = asyncio.get_event_loop().time() + HARD_TIMEOUT_SECS
    loop = asyncio.get_event_loop()
    while result is None and error_msg is None:
        try:
            await asyncio.wait_for(
                asyncio.shield(consume_task), timeout=poll_gap
            )
            break  # 事件流正常结束（无 finish/error 也算结束）
        except asyncio.TimeoutError:
            pass
        except asyncio.CancelledError:
            break
        dual = _find_dual()
        if dual:
            try:
                size = os.path.getsize(dual)
                age = time.time() - os.path.getmtime(dual)
            except OSError:
                size, age = -1, 0
            if size > 0 and size == last_size and age > DUAL_STABLE_SECS / 2:
                if stable_since is None:
                    stable_since = time.time()
                elif time.time() - stable_since >= DUAL_STABLE_SECS:
                    dual_path = dual
                    break
            else:
                stable_since = None
            last_size = size
        if loop.time() > deadline:
            error_msg = "导出超时（4 小时）"
            break

    if dual_path and result is None:
        mono = dual_path.replace(".dual.pdf", ".mono.pdf")
        result = {
            "dual": dual_path,
            "mono": mono if os.path.isfile(mono) else "",
        }
    elif result is None:
        # 事件流提前结束但看门狗未达稳定窗口：最后查一次产物兜底
        dual = _find_dual()
        if dual and os.path.isfile(dual):
            mono = dual.replace(".dual.pdf", ".mono.pdf")
            result = {"dual": dual, "mono": mono if os.path.isfile(mono) else ""}

    if error_msg:
        _emit({"type": "error", "error": error_msg})
        _force_exit()
    if not result or not result.get("dual") or not os.path.isfile(result["dual"]):
        _emit({"type": "error", "error": "dual PDF 产物未找到（事件流与产物看门狗均未命中）"})
        _force_exit()
    _emit({"type": "finish", "dual": result["dual"], "mono": result["mono"]})
    _force_exit()


def _force_exit() -> None:
    """冲刷 stdout 后硬退出：BabelDOC 线程池残留会让正常退出挂死。"""
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        _emit({"type": "error", "error": "cancelled"})
    except Exception as e:  # noqa: BLE001 — 兜底：任何异常都以 error 行上报而非裸崩
        _emit({"type": "error", "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
