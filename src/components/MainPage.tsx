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
        className={`w-full max-w-lg border-2 rounded-xl p-12 text-center transition-all cursor-pointer ${
          isDragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
            : "border-dashed border-gray-300 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-600"
        }`}
        onClick={handleBrowse}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="text-6xl mb-4">📄</div>
        <h2 className="text-xl font-semibold mb-2 dark:text-gray-100">
          {isDragging ? "松开以加载 PDF" : "点击选择或拖入 PDF 文件"}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          支持 PDF 格式，点击浏览或拖拽到此处
        </p>
      </div>

      {file && (
        <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
          <p className="text-sm dark:text-gray-200">
            已选择: <span className="font-medium">{file.name}</span>
          </p>
        </div>
      )}

      {isLoading && (
        <div className="w-full max-w-lg mt-4">
          <LoadingSpinner text={`正在识别与翻译… ${Math.round(progress)}%`} />
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-2 transition-all duration-300"
              style={{ width: `${Math.max(2, Math.round(progress))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 w-full max-w-lg p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-300">{String(error)}</p>
        </div>
      )}
    </div>
  );
}
