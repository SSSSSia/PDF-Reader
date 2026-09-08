import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { useOcr } from "../hooks/useOcr";
import { openFileDialog, uploadFile, isTauri, listDocs, openDoc } from "../lib/bridge";
import type { DocMeta } from "../types";
import LoadingSpinner from "./common/LoadingSpinner";

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
  // 阶段6-T3：主页"已翻译文章"列表（持久化文档索引）
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // 首次进入主页拉取列表；从阅读页返回时刷新（可能刚翻完新文档）
  useEffect(() => {
    listDocs()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);

  // pages 首次非空（后端 OCR 完成、progress≈30）即进入阅读页，原文立即可见、译文渐进流入
  useEffect(() => {
    if (pages.length > 0 && !navigatedRef.current) {
      navigatedRef.current = true;
      navigate(mode === "inline" ? "/reader/inline" : "/reader/bilingual");
    }
  }, [pages, mode, navigate]);

  // Tauri 环境下监听 OS 文件拖拽（HTML5 drop 在 Tauri 中会被拦截，需走 webview 事件）
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
    setFile({
      name: selected.split(/[\\/]/).pop() || selected,
      size: 0,
      type: "application/pdf",
      path: selected,
    } as any);
    setFilePath(selected);

    // 不 await：跳转由上方 pages 就绪 effect 驱动（OCR 完成即进阅读页），
    // processFile 的轮询闭包持有 zustand setter，MainPage 卸载后仍正常回传。
    navigatedRef.current = false;
    void processFile(selected);
  };

  /** 打开已翻译文章（阶段6-T3）：缓存重建秒开，不重跑管线 */
  const handleOpenDoc = async (doc: DocMeta) => {
    if (openingId) return;
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

  const handleBrowse = async () => {
    const selected = await openFileDialog();
    if (!selected) return;
    await handlePath(selected);
  };

  // 浏览器模式下 HTML5 拖拽（Tauri 模式走 webview 的 onDragDropEvent，这里跳过）
  const handleDrop = async (e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return;
    const path = await uploadFile(file);
    if (path) await handlePath(path);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div
        role="button"
        tabIndex={0}
        aria-label="选择或拖入 PDF 文件"
        onClick={handleBrowse}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleBrowse();
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={`w-full max-w-lg rounded-xl border-2 p-6 text-center transition-colors duration-150 cursor-pointer sm:p-10 ${
          isDragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
            : "border-dashed border-slate-300 hover:border-blue-400 hover:bg-white dark:border-slate-600 dark:hover:border-blue-500 dark:hover:bg-slate-800"
        }`}
      >
        <div className="mb-3 text-5xl" aria-hidden="true">
          {isDragging ? "📂" : "📄"}
        </div>
        <h2 className="mb-1.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {isDragging ? "松开以加载 PDF" : "点击选择或拖入 PDF 文件"}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          识别完成后自动进入阅读，译文边译边显示
        </p>
      </div>

      {/* 阶段6-T3：已翻译文章列表（持久化索引，点击缓存重建秒开） */}
      {docs !== null && docs.length > 0 && (
        <div className="mt-8 w-full max-w-lg animate-fade-in">
          <h2 className="mb-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400">
            已翻译文章（{docs.length}）
          </h2>
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.doc_id}>
                <button
                  onClick={() => handleOpenDoc(d)}
                  disabled={openingId !== null}
                  title={
                    d.file_exists === false
                      ? "源 PDF 已移动/删除：对照与紧跟模式可用，原版模式不可用"
                      : "打开已翻译内容（秒开，不重新翻译）"
                  }
                  className="card w-full px-4 py-3 text-left transition-colors duration-150 hover:border-blue-400 disabled:cursor-wait disabled:opacity-60 dark:hover:border-blue-500"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
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
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openingId && (
        <div className="mt-4 w-full max-w-lg animate-fade-in">
          <LoadingSpinner text="正在打开…" />
        </div>
      )}

      {file && (
        <div className="card mt-4 w-full max-w-lg px-4 py-3 animate-fade-in">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            已选择:{" "}
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {file.name}
            </span>
          </p>
        </div>
      )}

      {isLoading && (
        <div className="mt-4 w-full max-w-lg animate-fade-in">
          <LoadingSpinner text={`正在识别与翻译… ${Math.round(progress)}%`} />
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            style={{ height: 6 }}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.max(2, Math.round(progress))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 w-full max-w-lg rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800/60 dark:bg-red-900/20 animate-fade-in"
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
