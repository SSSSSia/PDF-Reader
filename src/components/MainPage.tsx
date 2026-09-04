import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { useOcr } from "../hooks/useOcr";
import LoadingSpinner from "./common/LoadingSpinner";

export default function MainPage() {
  const { setFile, setFilePath, file, isLoading, progress, error } = usePdfStore();
  const { mode } = useUiStore();
  const { processFile } = useOcr();
  const navigate = useNavigate();

  const handleBrowse = async () => {
    const selected = await open({
      title: "选择 PDF 文件",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;

    // Windows 路径分隔符可能是 \，需同时兼容 /
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

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div
        className="w-full max-w-lg border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 hover:bg-gray-50 transition-all cursor-pointer"
        onClick={handleBrowse}
      >
        <div className="text-6xl mb-4">📄</div>
        <h2 className="text-xl font-semibold mb-2">点击选择 PDF 文件</h2>
        <p className="text-gray-500 text-sm">支持 PDF 格式，点击浏览</p>
      </div>

      {file && (
        <div className="mt-4 p-4 bg-white rounded-lg shadow">
          <p className="text-sm">
            已选择: <span className="font-medium">{file.name}</span>
          </p>
        </div>
      )}

      {isLoading && (
        <div className="w-full max-w-lg mt-4">
          <LoadingSpinner text={`正在识别与翻译… ${Math.round(progress)}%`} />
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-2 transition-all duration-300"
              style={{ width: `${Math.max(2, Math.round(progress))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 w-full max-w-lg p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{String(error)}</p>
        </div>
      )}
    </div>
  );
}
