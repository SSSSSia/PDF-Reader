import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { useOcr } from "../hooks/useOcr";
import { openFileDialog, uploadFile, isTauri, listDocs, openDoc } from "../lib/bridge";
import { useDocThumbnails } from "../hooks/useDocThumbnails";
import type { DocMeta } from "../types";
import LoadingSpinner from "./common/LoadingSpinner";

/**
 * 文献库（主页，2026-09-09 靠岸学术风格改版）：
 * - 页头「文献库 + 添加文章按钮」；计数/搜索行；3 列首页缩略图卡片网格；
 * - 空状态保留整块拖拽上传区（老入口不丢弃）；
 * - 有文献时仍支持整页拖入 PDF（Tauri 原生事件 / 浏览器 HTML5 drop）；
 * - 翻译进度内联显示，OCR 完成自动进入阅读页；点击卡片缓存秒开。
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
  const [query, setQuery] = useState("");
  const thumbs = useDocThumbnails(docs);

  // 首次进入主页拉取列表；从阅读页返回时重挂载自动刷新（可能刚翻完新文档）
  useEffect(() => {
    listDocs()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);

  // pages 首次非空（后端 OCR 完成、progress≈30）即进入阅读页。
  // 仅在翻译进行中（isLoading）触发：从阅读页返回文献库时 pdfStore 仍持有
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
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!dropped.name.toLowerCase().endsWith(".pdf")) return;
    const path = await uploadFile(dropped);
    if (path) await handlePath(path);
  };

  /** 打开已翻译文章：内存有该篇结果直接恢复；否则缓存重建秒开（阶段6-T3） */
  const handleOpenDoc = async (doc: DocMeta) => {
    if (openingId) return;
    // 内存命中：当前 pdfStore 装的就是这一篇（路径一致且有内容），直接回阅读页。
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
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs ?? [];
    return (docs ?? []).filter((d) => d.title.toLowerCase().includes(q));
  }, [docs, query]);

  return (
    <div
      className="relative mx-auto max-w-5xl"
      onDragOver={(e) => {
        if (isTauri()) return;
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* 整页拖入提示层（有文献时拖拽反馈；空状态由大拖拽区自行高亮） */}
      {isDragging && hasDocs && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/80 dark:border-blue-400 dark:bg-blue-900/30">
          <p className="text-sm font-medium text-blue-600 dark:text-blue-300">
            松开即可开始翻译
          </p>
        </div>
      )}

      {/* 页头：标题 + 添加文章按钮（靠岸学术式右置主操作） */}
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          文献库
        </h1>
        <button
          onClick={() => navigate("/add")}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加文章
        </button>
      </header>

      {/* 空状态：整块拖拽上传区作主视觉（入口不丢弃） */}
      {docs !== null && !hasDocs && (
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
          onDragOver={(e) => {
            if (isTauri()) return;
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mt-8 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors duration-150 sm:py-20 ${
            isDragging
              ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20"
              : "border-slate-300 hover:border-blue-400 hover:bg-white dark:border-slate-600 dark:hover:border-blue-500 dark:hover:bg-slate-800/60"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-12 w-12 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
          >
            <path d="M14.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7L14.5 3z" />
            <path d="M14.5 3v4h4" />
            <path d="M12 11v6M9.5 14.5 12 17l2.5-2.5" />
          </svg>
          <p className="text-base font-medium text-slate-900 dark:text-slate-100">
            {isDragging ? "松开即可开始翻译" : "将 PDF 拖放到这里"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            或点击选择文件 · 翻译完成后自动加入文献库
          </p>
        </div>
      )}

      {docs === null && (
        <div className="mt-8">
          <LoadingSpinner text="加载文献库…" />
        </div>
      )}

      {/* 计数 + 搜索行 */}
      {hasDocs && (
        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
            {docs === null ? "…" : `共 ${docs.length} 篇文献`}
          </p>
          <div className="relative w-56 sm:w-64">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索文献"
              aria-label="搜索文献"
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-400"
            />
          </div>
        </div>
      )}

      {/* 翻译进行中：内联进度（返回文献库不中断，OCR 完成自动进阅读页） */}
      {isLoading && file && (
        <div className="card mt-5 px-4 py-3.5 animate-fade-in">
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

      {/* 已翻译文献：3 列首页缩略图卡片网格 */}
      {hasDocs && filtered.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <li key={d.doc_id}>
              <button
                onClick={() => handleOpenDoc(d)}
                disabled={openingId !== null}
                title={
                  d.file_exists === false
                    ? "源 PDF 已移动/删除：对照与紧跟模式可用，原版模式不可用"
                    : "打开已翻译内容（秒开，不重新翻译）"
                }
                className="card group block w-full overflow-hidden text-left transition-colors duration-150 hover:border-slate-400 disabled:cursor-wait disabled:opacity-60 dark:hover:border-slate-500"
              >
                {/* 首页缩略图（A4 纵向比例；失败/缺失显示占位） */}
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                  {thumbs[d.doc_id] ? (
                    <img
                      src={thumbs[d.doc_id]}
                      alt=""
                      className="h-full w-full object-cover object-top"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-10 w-10"
                        aria-hidden="true"
                      >
                        <path d="M14.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7L14.5 3z" />
                        <path d="M14.5 3v4h4" />
                      </svg>
                      <span className="text-xs font-medium tracking-wide">
                        {d.file_exists === false ? "源文件缺失" : "PDF"}
                      </span>
                    </div>
                  )}
                  {d.file_exists === false && thumbs[d.doc_id] && (
                    <span className="absolute right-2 top-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      源文件缺失
                    </span>
                  )}
                </div>
                {/* 标题 + 元信息 */}
                <div className="px-3.5 py-3">
                  <p
                    className="truncate text-sm font-medium text-slate-900 dark:text-slate-100"
                    title={d.title}
                  >
                    {d.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {d.translated_at} · {d.page_count} 页
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 搜索无结果 */}
      {hasDocs && filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">
          没有匹配「{query}」的文献
        </p>
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
