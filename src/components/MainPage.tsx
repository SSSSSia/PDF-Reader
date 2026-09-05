import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { useOcr } from "../hooks/useOcr";
import { openFileDialog, uploadFile, isTauri } from "../lib/bridge";
import LoadingSpinner from "./common/LoadingSpinner";

export default function MainPage() {
  const { setFile, setFilePath, file, isLoading, progress, error } = usePdfStore();
  const { mode } = useUiStore();
  const { processFile } = useOcr();
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);

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

    const ok = await processFile(selected);
    if (ok) {
      navigate(mode === "inline" ? "/reader/inline" : "/reader/bilingual");
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
          识别与翻译完成后自动进入双语阅读
        </p>
      </div>

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
        </div>
      )}
    </div>
  );
}
