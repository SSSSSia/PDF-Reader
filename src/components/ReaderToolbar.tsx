import { Link, useNavigate } from "react-router-dom";
import {
  useUiStore,
  effectiveZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_ORIGINAL_DEFAULT,
} from "../stores/uiStore";
import { usePdfStore } from "../stores/pdfStore";
import ExportBar from "./ExportBar";

/**
 * 阅读页共享工具栏：「← 文档库」返回 + 文章标题 ｜ 阅读模式切换（分段控件）+ 缩放 + 导出。
 * 由 BilingualPage 与 InlinePage 共用，保证两个视图工具栏完全一致。
 * 注：原 PdfViewer 页码导航已随「整篇连续滚动」改版移除（用户决策 2026-09-06）。
 * 「原版」为叠加视图（阶段5-T2/D6）：pdfjs 原样渲染当前 PDF + 块坐标译文浮层。
 * 阶段6-T3：源 PDF 缺失（从主页重开已删/移动的文档）时「原版」禁用并提示。
 * 2026-09-09 页面逻辑重规划：顶栏左侧常驻「← 文档库」返回 + 当前文章标题。
 * 阶段7-T1：全局缩放控件（−/百分比/＋，与 Ctrl+滚轮共用 uiStore.zoom 并持久化；
 * 点击百分比重置 100%）。三形态共用同一缩放值。
 */
export default function ReaderToolbar() {
  const { mode, setMode, readerMode, setReaderMode, zoom: zoomRaw, stepZoom, resetZoom } =
    useUiStore();
  const { filePath, file } = usePdfStore();
  const navigate = useNavigate();
  const sourceMissing = !filePath;
  // 阶段7-T2：显示与边界判断用有效缩放值（未设置过时按形态回落缺省：
  // 原版 70% / 重排版 100%），与阅读区实际渲染一致
  const zoom = effectiveZoom(zoomRaw, readerMode);
  // 文章标题：重开文档时为 doc.title，新翻译时为文件名（去 .pdf 后缀）
  const docTitle = (file?.name ?? "").replace(/\.pdf$/i, "");

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
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/"
          className="shrink-0 rounded-md px-2 py-1.5 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="返回文档库（翻译结果保留，可直接再进入）"
        >
          ← 文档库
        </Link>
        {docTitle && (
          <span
            className="min-w-0 truncate text-sm font-medium text-slate-700 dark:text-slate-300"
            title={docTitle}
          >
            {docTitle}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
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
        {/* 阶段7-T1/T2 全局缩放：三形态共用；百分比重置回形态缺省
            （原版 70% / 重排版 100%，并清除持久化） */}
        <div
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-800"
          role="group"
          aria-label="缩放"
        >
          <button
            onClick={() => stepZoom(-0.1)}
            disabled={zoom <= ZOOM_MIN}
            aria-label="缩小"
            title="缩小（也可用 Ctrl+滚轮）"
            className="h-6 w-6 rounded text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            −
          </button>
          <button
            onClick={resetZoom}
            title={
              originalActive
                ? `点击重置为缺省 ${Math.round(ZOOM_ORIGINAL_DEFAULT * 100)}%`
                : "点击重置为 100%"
            }
            className="w-11 text-center text-xs tabular-nums text-slate-600 transition-colors duration-150 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => stepZoom(0.1)}
            disabled={zoom >= ZOOM_MAX}
            aria-label="放大"
            title="放大（也可用 Ctrl+滚轮）"
            className="h-6 w-6 rounded text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            ＋
          </button>
        </div>
        <ExportBar />
      </div>
    </div>
  );
}
