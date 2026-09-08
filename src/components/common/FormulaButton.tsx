import { useState } from "react";
import { usePdfStore } from "../../stores/pdfStore";
import { recognizeBlockFormula } from "../../lib/bridge";
import type { TextBlock } from "../../types";

/**
 * 公式块按需识别按钮（2026-09-08 用户决策）：
 * 公式密集块（formula_hint）悬停显示「式」，点击裁剪块区域送视觉模型
 * （PaddleOCR-VL）转 LaTeX，结果就地替换译文位（KaTeX 渲染）。
 * 后端按 (pdf_hash,page,bbox,model) 缓存，重复点按/重开文档幂等零成本。
 * 需要块有 bbox（坐标裁剪的前提，未匹配块不显示按钮）。
 */
export default function FormulaButton({ block }: { block: TextBlock }) {
  const [state, setState] = useState<"idle" | "busy" | "err">("idle");
  const filePath = usePdfStore((s) => s.filePath);
  const isLoading = usePdfStore((s) => s.isLoading);
  const updateBlockTranslated = usePdfStore((s) => s.updateBlockTranslated);
  const bbox = block.bbox;

  const onClick = async () => {
    if (!filePath || !bbox) return;
    setState("busy");
    try {
      const { latex } = await recognizeBlockFormula(filePath, block.page, bbox);
      if (latex.trim()) {
        updateBlockTranslated(block.page, block.block_id, latex);
        setState("idle");
      } else {
        setState("err");
      }
    } catch (e) {
      console.error("公式识别失败:", e);
      setState("err");
    }
  };

  const label =
    state === "busy" ? "识别中…" : state === "err" ? "重试" : "式";
  const disabled = isLoading || state === "busy" || !filePath || !bbox;
  const title = !bbox
    ? "该公式块未匹配到坐标，无法裁剪识别"
    : "识别此块公式为 LaTeX 渲染";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-1.5 py-0.5 text-xs shadow-sm transition-colors ${
        state === "err"
          ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-300"
          : "border-slate-200 bg-white text-slate-500 hover:border-violet-400 hover:text-violet-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-violet-500 dark:hover:text-violet-300"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {label}
    </button>
  );
}
