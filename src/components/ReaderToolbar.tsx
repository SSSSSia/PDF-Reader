import { useNavigate } from "react-router-dom";
import { useUiStore } from "../stores/uiStore";
import ExportBar from "./ExportBar";

/**
 * 阅读页共享工具栏：阅读模式切换（分段控件）+ 导出。
 * 由 BilingualPage 与 InlinePage 共用，保证两个视图工具栏完全一致。
 * 注：原 PdfViewer 页码导航已随「整篇连续滚动」改版移除（用户决策 2026-09-06）。
 */
export default function ReaderToolbar() {
  const { mode, setMode } = useUiStore();
  const navigate = useNavigate();

  // 切换模式同时跳转对应路由（两个视图各自是独立页面组件）
  const switchMode = (m: "bilingual" | "inline") => {
    if (m === mode) return;
    setMode(m);
    navigate(m === "inline" ? "/reader/inline" : "/reader/bilingual");
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div
        className="inline-flex items-center rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
        role="tablist"
        aria-label="阅读模式"
      >
        <button
          role="tab"
          aria-selected={mode === "bilingual"}
          onClick={() => switchMode("bilingual")}
          className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
            mode === "bilingual"
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          左右对照
        </button>
        <button
          role="tab"
          aria-selected={mode === "inline"}
          onClick={() => switchMode("inline")}
          className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
            mode === "inline"
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          紧跟模式
        </button>
      </div>
      <ExportBar />
    </div>
  );
}
