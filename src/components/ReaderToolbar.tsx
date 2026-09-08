import { useNavigate } from "react-router-dom";
import { useUiStore } from "../stores/uiStore";
import { usePdfStore } from "../stores/pdfStore";
import ExportBar from "./ExportBar";

/**
 * 阅读页共享工具栏：阅读模式切换（分段控件）+ 导出。
 * 由 BilingualPage 与 InlinePage 共用，保证两个视图工具栏完全一致。
 * 注：原 PdfViewer 页码导航已随「整篇连续滚动」改版移除（用户决策 2026-09-06）。
 * 「原版」为叠加视图（阶段5-T2/D6）：pdfjs 原样渲染当前 PDF + 块坐标译文浮层，
 * 进入时保持当前路由，退出（再点对照/紧跟）回到提取式视图——现有效果完整保留。
 * 阶段6-T3：源 PDF 缺失（从主页重开已删/移动的文档）时「原版」禁用并提示。
 */
export default function ReaderToolbar() {
  const { mode, setMode, readerMode, setReaderMode } = useUiStore();
  const filePath = usePdfStore((s) => s.filePath);
  const navigate = useNavigate();
  const sourceMissing = !filePath;

  // 切换模式同时跳转对应路由（两个视图各自是独立页面组件）
  const switchMode = (m: "bilingual" | "inline") => {
    if (readerMode === "parallel" && m === mode) return;
    setReaderMode("parallel");
    setMode(m);
    navigate(m === "inline" ? "/reader/inline" : "/reader/bilingual");
  };

  const originalActive = readerMode === "original";

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div
        className="inline-flex items-center rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
        role="tablist"
        aria-label="阅读模式"
      >
        <button
          role="tab"
          aria-selected={!originalActive && mode === "bilingual"}
          onClick={() => switchMode("bilingual")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
            !originalActive && mode === "bilingual"
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          左右对照
        </button>
        <button
          role="tab"
          aria-selected={!originalActive && mode === "inline"}
          onClick={() => switchMode("inline")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
            !originalActive && mode === "inline"
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          紧跟模式
        </button>
        <button
          role="tab"
          aria-selected={originalActive}
          disabled={sourceMissing}
          title={
            sourceMissing
              ? "源 PDF 已移动/删除，原版模式不可用（对照/紧跟不受影响）"
              : "按原版排版对照译文"
          }
          onClick={() => setReaderMode(originalActive ? "parallel" : "original")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
            originalActive
              ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          原版
        </button>
      </div>
      <ExportBar />
    </div>
  );
}
