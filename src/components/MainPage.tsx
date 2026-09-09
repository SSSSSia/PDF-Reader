import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useOcr } from "../hooks/useOcr";
import { openFileDialog, uploadFile, isTauri, openDoc } from "../lib/bridge";
import { useDocThumbnails } from "../hooks/useDocThumbnails";
import type { DocMeta } from "../types";
import LoadingSpinner from "./common/LoadingSpinner";

/**
 * 文献库（主页 + 文件夹视图，2026-09-09 靠岸学术风格一比一复刻）：
 * - 左侧边栏（Layout/Sidebar）负责导航与文件夹分组，本页负责网格内容；
 * - /folder/:folderId 进入文件夹视图（标题为文件夹名，仅显示归档文献）；
 * - 卡片：小尺寸居中首页缩略图 + 两行标题 + 元信息，hover 出「⋯」移动菜单；
 * - 空状态保留整块拖拽上传区；有文献后仍支持整页拖入 PDF；
 * - 翻译进度内联显示，OCR 完成自动进入阅读页；点击卡片缓存秒开。
 */
export default function MainPage() {
  const { folderId } = useParams();
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
  const { docs, folders, loaded, fetchAll, moveDoc } = useLibraryStore();
  const { processFile } = useOcr();
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  // 阶段1-T2：跳转时机由「全部翻译完成」提前到「pages 就绪（OCR 完成）」。
  // 用 ref 保证同一文件只跳一次；处理新文件时重置。
  const navigatedRef = useRef(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 「移动到文件夹」菜单当前展开的文档（null = 关闭）
  const [menuDoc, setMenuDoc] = useState<DocMeta | null>(null);
  const thumbs = useDocThumbnails(docs);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // pages 首次非空（后端 OCR 完成、progress≈30）即进入阅读页。
  // 仅在翻译进行中（isLoading）且「本页挂载时 pages 为空 → 变非空」才触发：
  // 用户在翻译途中主动回到文献库（挂载时 pages 已非空）不会被弹回阅读页
  // （2026-09-09 用户反馈：翻译途中点文档库会一直跳回翻译页）。
  const pagesWereEmptyRef = useRef(pages.length === 0);
  useEffect(() => {
    if (
      isLoading &&
      pages.length > 0 &&
      pagesWereEmptyRef.current &&
      !navigatedRef.current
    ) {
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
    pagesWereEmptyRef.current = true; // 本页发起的新翻译：pages 清空后待其就绪自动跳转
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
    // 翻译进行中不开新会话：管线轮询正在向同一 pdfStore 写 pages，
    // 打开其他文献会互相覆盖（2026-09-09 用户反馈的跳转混乱同源）
    if (usePdfStore.getState().isLoading) return;
    if (openingId) return;
    // 内存命中：当前 pdfStore 装的就是这一篇（路径一致且有内容），直接回阅读页。
    const currentPath = (file as { path?: string } | null)?.path;
    if (pages.length > 0 && currentPath && currentPath === doc.file_path) {
      navigatedRef.current = true;
      navigate(mode === "inline" ? "/reader/inline" : "/reader/bilingual");
      return;
    }
    setOpeningId(doc.doc_id);
    setMenuDoc(null);
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

  const currentFolder = folderId
    ? folders.find((f) => f.folder_id === folderId)
    : undefined;

  const folderDocs = useMemo(
    () =>
      folderId ? docs.filter((d) => d.folder_id === folderId) : docs,
    [docs, folderId],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folderDocs;
    return folderDocs.filter((d) => d.title.toLowerCase().includes(q));
  }, [folderDocs, query]);

  const hasDocs = folderDocs.length > 0;

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

      {/* 页头：标题 + 添加文章按钮 */}
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {currentFolder ? currentFolder.name : "文献库"}
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

      {/* 空状态：整块拖拽上传区作主视觉（入口不丢弃）；文件夹不存在单独提示 */}
      {loaded && folderId && !currentFolder && (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">
          该文件夹不存在或已被删除。
        </p>
      )}
      {loaded && !folderId && !hasDocs && (
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

      {!loaded && (
        <div className="mt-8">
          <LoadingSpinner text="加载文献库…" />
        </div>
      )}

      {/* 计数 + 搜索行：有文献，或文件夹视图（空文件夹也显示，避免整页空白） */}
      {(hasDocs || (loaded && currentFolder)) && (
        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
            共 {folderDocs.length} 篇文献
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

      {/* 文献网格：小尺寸居中首页缩略图卡片（3 列） */}
      {hasDocs && filtered.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <li key={d.doc_id} className="group relative">
              {/* 卡片主体（div+role：内部还要放「⋯」按钮，避免 button 嵌套） */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => void handleOpenDoc(d)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void handleOpenDoc(d);
                  }
                }}
                title={
                  isLoading
                    ? "翻译进行中，完成后即可打开文献"
                    : d.file_exists === false
                      ? "源 PDF 已移动/删除：对照与紧跟模式可用，原版模式不可用"
                      : "打开已翻译内容（秒开，不重新翻译）"
                }
                className={`card h-full cursor-pointer p-3 transition-colors duration-150 hover:border-slate-400 dark:hover:border-slate-500 ${
                  openingId ? "cursor-wait opacity-60" : ""
                }`}
              >
                {/* 缩略图：小尺寸居中（白边留白），不再整卡满铺 */}
                <div className="flex h-44 items-center justify-center overflow-hidden rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                  {thumbs[d.doc_id] ? (
                    <img
                      src={thumbs[d.doc_id]}
                      alt=""
                      className="max-h-full max-w-full rounded-sm object-contain shadow-sm ring-1 ring-slate-200 dark:ring-slate-700"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-slate-400 dark:text-slate-500">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-9 w-9"
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
                </div>
                {/* 标题（两行截断）+ 元信息 */}
                <div className="px-1 pb-1 pt-2.5">
                  <p
                    className="line-clamp-2 min-h-[2.5em] text-sm font-medium leading-snug text-slate-900 dark:text-slate-100"
                    title={d.title}
                  >
                    {d.title}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {d.translated_at} · {d.page_count} 页
                  </p>
                </div>
              </div>

              {/* 「⋯」移动到文件夹菜单（hover 显现；阻止冒泡不触发打开） */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuDoc(menuDoc?.doc_id === d.doc_id ? null : d);
                }}
                title="移动到文件夹"
                aria-label={`移动 ${d.title} 到文件夹`}
                className={`absolute right-4 top-4 z-10 rounded-md bg-white/90 p-1 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-opacity duration-150 hover:text-slate-800 dark:bg-slate-900/90 dark:ring-slate-700 dark:hover:text-slate-100 ${
                  menuDoc?.doc_id === d.doc_id
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>
              {menuDoc?.doc_id === d.doc_id && (
                <>
                  {/* 点击菜单外区域关闭 */}
                  <div
                    className="fixed inset-0 z-20"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuDoc(null);
                    }}
                  />
                  <div className="absolute right-4 top-11 z-30 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <p className="px-3 py-1.5 text-xs font-semibold text-slate-400 dark:text-slate-500">
                      移动到文件夹
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void moveDoc(d.doc_id, null).then(() => setMenuDoc(null));
                      }}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      未分类
                      {!d.folder_id && (
                        <span className="text-xs text-blue-600 dark:text-blue-400">✓</span>
                      )}
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.folder_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void moveDoc(d.doc_id, f.folder_id).then(() =>
                            setMenuDoc(null),
                          );
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <span className="min-w-0 truncate">{f.name}</span>
                        {d.folder_id === f.folder_id && (
                          <span className="shrink-0 text-xs text-blue-600 dark:text-blue-400">✓</span>
                        )}
                      </button>
                    ))}
                    {folders.length === 0 && (
                      <p className="px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500">
                        尚无文件夹，可在左侧新建
                      </p>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 空文件夹：虚线空态提示（计数/搜索行已在上方显示） */}
      {loaded && currentFolder && !hasDocs && (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-600">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-10 w-10 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
          >
            <path d="M4 5h5l2 2.5h9V19a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 19V6.5A1.5 1.5 0 0 1 4.5 5z" />
          </svg>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            该文件夹暂无文献
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            在文献库中点击卡片右上角「⋯」即可将文献移入
          </p>
        </div>
      )}

      {/* 搜索/过滤无结果 */}
      {hasDocs && filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {query.trim()
            ? `没有匹配「${query}」的文献`
            : "该文件夹暂无文献 · 通过卡片右上角「⋯」归档"}
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
