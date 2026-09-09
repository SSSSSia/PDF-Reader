import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { useOcr } from "../hooks/useOcr";
import { openFileDialog, uploadFile, isTauri, listDocs, openDoc } from "../lib/bridge";
import type { DocMeta } from "../types";
import LoadingSpinner from "./common/LoadingSpinner";

/**
 * 文档库（主页，2026-09-09 页面逻辑重规划）：
 * - 已翻译文章卡片列表为主体；「+ 翻译新文档」按钮 + 整页拖拽为入口；
 * - 首次使用（列表为空）显示虚线拖拽区作主视觉，有文章后收起；
 * - 翻译进度内联显示（返回文档库不中断），OCR 完成自动进入阅读页；
 * - 点击文章：内存有该篇结果直接恢复，否则缓存重建秒开（不重跑管线）。
 */
export default function MainPage() {
  const {
    setFile,
    setFilePath,
    file,
    pages,
    isLoading,
    progress,
    error,
    setError,
    setResult,
    setCurrentPage,
    setPages,
  } = usePdfStore();
  const { mode } = useUiStore();
  const { processFile } = useOcr();
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  // 阶段1-T2：跳转时机由「全部翻译完成」提前到「pages 就绪（OCR 完成）」。
  // 用 ref 保证同一文件只跳一次；处理新文件时重置。
  const navigatedRef = useRef(false);
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // 首次进入主页拉取列表；从阅读页返回时重挂载自动刷新（可能刚翻完新文档）
  useEffect(() => {
    listDocs()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);

  // pages 首次非空（后端 OCR 完成、progress≈30）即进入阅读页。
  // 仅在翻译进行中（isLoading）触发：从阅读页返回文档库时 pdfStore 仍持有
  // 上篇结果，若无条件跳转会立刻把用户弹回阅读页（2026-09-09 用户反馈的
  // 「← 文档库返回不了主页」即此因）。
  useEffect(() => {
    if (isLoading && pages.length > 0 && !navigatedRef.current) {
      navigatedRef.current = true;
      navigate(mode === "inline" ? "/reader/inline" : "/reader/bilingual");
    }
  }, [isLoading, pages, mode, navigate]);

  // Tauri 环境下监听 OS 文件拖拽（整页生效；HTML5 drop 在 Tauri 中会被拦截）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if ("__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) => {
          getCurrentWebview()
            .onDragDropEvent((event) => {
              const payload = event.payload;
              if (payload.type === "enter" || payload.type === "over") {
                setIsDragging(true);
              } else if (payload.type === "leave") {
                setIsDragging(false);
              } else if (payload.type === "drop") {
                setIsDragging(false);
                const paths = payload.paths;
                if (paths && paths.length > 0) {
                  handlePath(paths[0]);
                }
              }
            })
            .then((fn) => {
              unlisten = fn;
            });
        })
        .catch(() => {
          /* 非 Tauri 环境忽略 */
        });
    }
    return () => unlisten?.();
  }, []);

  const handlePath = async (selected: string) => {
    if (!selected.toLowerCase().endsWith(".pdf")) {
      return;
    }
    // 翻译进行中不接受新文件（防止双管线并发轮询互相污染进度显示）
    if (usePdfStore.getState().isLoading) return;
    setFile({
      name: selected.split(/[\\/]/).pop() || selected,
      size: 0,
      type: "application/pdf",
      path: selected,
    } as any);
    setFilePath(selected);
    // 新翻译开始：清掉上一篇的内存结果，避免旧内容闪现/干扰自动跳转判定
    setPages([]);
    setResult(null);
    setError(null);

    // 不 await：跳转由上方 pages 就绪 effect 驱动（OCR 完成即进阅读页），
    // processFile 的轮询闭包持有 zustand setter，MainPage 卸载后仍正常回传。
    navigatedRef.current = false;
    void processFile(selected);
  };

  const handleBrowse = async () => {
    const selected = await openFileDialog();
    if (!selected) return;
    await handlePath(selected);
  };

  // 浏览器模式下 HTML5 拖拽（整页容器接收；Tauri 模式走 webview 事件，这里跳过）
  const handleDrop = async (e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return;
    const path = await uploadFile(file);
    if (path) await handlePath(path);
  };

  /** 打开已翻译文章：内存有该篇结果直接恢复；否则缓存重建秒开（阶段6-T3） */
  const handleOpenDoc = async (doc: DocMeta) => {
    if (openingId) return;
    // 内存命中：当前 pdfStore 装的就是这一篇（路径一致且有内容），直接回阅读页。
    // file 以 as any 存入（含 path 字段，见 handlePath），此处同样取扩展字段。
    const currentPath = (file as { path?: string } | null)?.path;
    if (pages.length > 0 && currentPath && currentPath === doc.file_path) {
      navigatedRef.current = true;
      navigate(mode === "inline" ? "/reader/inline" : "/reader/bilingual");
      return;
    }
    setOpeningId(doc.doc_id);
    setError(null);
    try {
      const r = await openDoc(doc.doc_id);
      setFile({
        name: `${doc.title}.pdf`,
        size: 0,
        type: "application/pdf",
        path: r.file_exists ? doc.file_path : "",
      } as any);
      // 源文件缺失：filePath 置 null（原版模式/式按钮自动禁用），对照/紧跟纯缓存可用
      setFilePath(r.file_exists ? doc.file_path : null);
      setResult(null);
      setCurrentPage(0);
      navigatedRef.current = true; // 直接导航，避免 pages effect 重复跳转
      setPages(r.pages);
      navigate("/reader/bilingual");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningId(null);
    }
  };

  const hasDocs = (docs?.length ?? 0) > 0;

  return (
    <div
      className="mx-auto max-w-2xl"
      onDragOver={(e) => {
        if (isTauri()) return;
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* 页头：大标题 + 一句式状态说明（不再挤"标题+计数"） */}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          文档库
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {docs === null
            ? "正在加载…"
            : hasDocs
              ? `已翻译 ${docs.length} 篇 · 点击卡片继续阅读`
              : "翻译你的第一篇论文，它会出现在这里"}
        </p>
      </header>

      {/* 上传面板（常驻入口；空状态为主视觉加大，有文章后收窄为横向条） */}
      <div
        role="button"
        tabIndex={0}
        aria-label="拖入或选择 PDF 文件开始翻译"
        onClick={handleBrowse}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleBrowse();
          }
        }}
        className={`flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed text-left transition-colors duration-150 ${
          hasDocs ? "px-5 py-4" : "px-6 py-12 sm:py-14"
        } ${
          isDragging
            ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20"
            : "border-slate-300 hover:border-blue-400 hover:bg-white dark:border-slate-600 dark:hover:border-blue-500 dark:hover:bg-slate-800/60"
        }`}
      >
        <div
          className={`flex shrink-0 items-center justify-center rounded-lg ${
            hasDocs ? "h-10 w-10" : "h-12 w-12"
          } bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={hasDocs ? "h-5 w-5" : "h-6 w-6"}
            aria-hidden="true"
          >
            <path d="M14.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7L14.5 3z" />
            <path d="M14.5 3v4h4" />
            <path d="M12 11v6M9.5 14.5 12 17l2.5-2.5" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`font-medium text-slate-900 dark:text-slate-100 ${
              hasDocs ? "text-sm" : "text-base"
            }`}
          >
            {isDragging ? "松开即可开始翻译" : "拖入 PDF 开始翻译"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {hasDocs
              ? "或点击选择文件 · 不影响下方已翻译文章"
              : "点击选择文件 · 识别完成后自动进入阅读，译文边译边显示"}
          </p>
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>

      {docs === null && (
        <div className="mt-4">
          <LoadingSpinner text="加载文档库…" />
        </div>
      )}

      {/* 翻译进行中：内联进度（返回文档库不中断，OCR 完成自动进阅读页） */}
      {isLoading && file && (
        <div className="card mt-4 px-4 py-3.5 animate-fade-in">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-300">
              正在翻译：
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {file.name}
              </span>
            </p>
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
              {Math.round(progress)}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            style={{ height: 6 }}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.max(2, Math.round(progress))}%` }}
            />
          </div>
        </div>
      )}

      {/* 已翻译文章卡片列表（阶段6-T3；卡片式定稿 2026-09-09） */}
      {hasDocs && (
        <>
          <h2 className="mb-2.5 mt-7 text-sm font-semibold text-slate-500 dark:text-slate-400">
            已翻译文章
          </h2>
          <ul className="space-y-2.5">
            {docs!.map((d) => (
              <li key={d.doc_id}>
                <button
                  onClick={() => handleOpenDoc(d)}
                  disabled={openingId !== null}
                  title={
                    d.file_exists === false
                      ? "源 PDF 已移动/删除：对照与紧跟模式可用，原版模式不可用"
                      : "打开已翻译内容（秒开，不重新翻译）"
                  }
                  className="group card flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 hover:border-slate-400 disabled:cursor-wait disabled:opacity-60 dark:hover:border-slate-500"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-semibold tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    PDF
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100"
                        title={d.title}
                      >
                        {d.title}
                      </span>
                      {d.file_exists === false && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          源文件缺失
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {d.translated_at} · {d.page_count} 页
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 shrink-0 text-slate-300 transition-colors duration-150 group-hover:translate-x-0.5 group-hover:text-blue-500 dark:text-slate-600 dark:group-hover:text-blue-400 motion-safe:transition-transform"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {openingId && (
        <div className="mt-4 animate-fade-in">
          <LoadingSpinner text="正在打开…" />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800/60 dark:bg-red-900/20 animate-fade-in"
        >
          <p className="text-sm text-red-700 dark:text-red-300">
            {String(error)}
          </p>
          {/* 阶段6-T1：Key 平时不再打扰；仅认证类失败时才引导进入设置 */}
          {/401|403|api[ _-]?key|认证|unauthorized|invalid[ _-]?key/i.test(
            String(error),
          ) && (
            <button
              onClick={() => navigate("/config")}
              className="mt-2 text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              前往设置检查 API Key →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
