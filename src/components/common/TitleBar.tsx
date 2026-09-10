import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePdfStore } from "../../stores/pdfStore";

/**
 * 自绘标题栏（阶段10-T3，2026-09-10 用户确认 mockup v3/v4）：
 * 同靠岸学术——标题栏只含「应用 logo（点击返回主页）+ 页面标题 + 窗口三钮」，
 * 功能按钮在下方工具栏（ReaderToolbar，第二行）；主页/阅读页共用本栏。
 *
 * - 仅 Tauri 环境渲染（浏览器 dev 无 decorations:false，无需窗口钮）
 * - 整栏为拖拽区（data-tauri-drag-region），按钮区 stopPropagation
 * - 双击最大化切换；关闭钮 hover 红色语义（桌面软件惯例）
 * - 权限：core:window:allow-minimize/toggle-maximize/close（capability 已放行）
 */
export default function TitleBar() {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const location = useLocation();
  const file = usePdfStore((s) => s.file);
  const [maximized, setMaximized] = useState(false);
  const [win, setWin] = useState<{
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    onResized: (h: () => void) => Promise<() => void>;
  } | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        setWin({
          minimize: () => void w.minimize(),
          toggleMaximize: () => void w.toggleMaximize(),
          close: () => void w.close(),
          onResized: (h) => w.onResized(h),
        });
        void w.isMaximized().then(setMaximized);
        void w.onResized(() => void w.isMaximized().then(setMaximized));
      })
      .catch(() => setWin(null));
  }, [isTauri]);

  // 页面标题：阅读页=文档名（去 .pdf），主页/设置=对应文案
  const isReader = location.pathname.startsWith("/reader");
  const docTitle = (file?.name ?? "").replace(/\.pdf$/i, "");
  const pageTitle = isReader
    ? docTitle || "阅读"
    : location.pathname === "/config"
      ? "设置"
      : location.pathname === "/add"
        ? "添加文献"
        : "主页";

  if (!isTauri) return null;

  const btn =
    "flex h-full w-11 items-center justify-center text-sm text-slate-500 transition-colors duration-150 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100";

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => win?.toggleMaximize()}
      className="flex h-9 shrink-0 select-none items-center gap-2 border-b border-slate-200 bg-slate-50 pl-3 dark:border-slate-700 dark:bg-slate-900"
    >
      {/* logo + 应用名：点击返回主页（同靠岸学术） */}
      <Link
        to="/"
        className="flex items-center gap-1.5 rounded px-1 py-0.5"
        title="返回主页"
      >
        <span
          aria-hidden="true"
          className="flex h-[18px] w-[18px] items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white"
        >
          译
        </span>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          PDF双语阅读器
        </span>
      </Link>
      {/* 页面标题（阅读页=文档名，超长省略） */}
      <span className="text-xs text-slate-400 dark:text-slate-500">/</span>
      <span
        className="min-w-0 max-w-[45%] truncate text-xs text-slate-700 dark:text-slate-200"
        title={pageTitle}
      >
        {pageTitle}
      </span>
      {/* 拖拽空白区 */}
      <div className="h-full flex-1" data-tauri-drag-region />
      {/* 窗口控制三钮（占满标题栏高度，点击区不触发拖拽） */}
      <div className="flex h-full items-center" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => win?.minimize()}
          aria-label="最小化"
          className={`${btn} rounded-bl-none`}
        >
          &#x2500;
        </button>
        <button
          onClick={() => win?.toggleMaximize()}
          aria-label={maximized ? "还原" : "最大化"}
          className={btn}
        >
          {maximized ? "\u2750" : "\u25A1"}
        </button>
        <button
          onClick={() => win?.close()}
          aria-label="关闭"
          className="flex h-full w-11 items-center justify-center text-sm text-slate-500 transition-colors duration-150 hover:bg-red-500 hover:text-white dark:text-slate-400"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}
