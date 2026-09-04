import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import LoadingSpinner from "./common/LoadingSpinner";
import PdfViewer from "./PdfViewer";

export default function InlinePage() {
  const { pages, currentPage, isLoading } = usePdfStore();
  const { mode, setMode } = useUiStore();

  // 按分页索引取当前页（修复 R2：原先只渲染 pages[0]）
  const page = pages[currentPage];

  if (isLoading) return <LoadingSpinner text="加载中..." />;
  if (!page) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-lg">请先上传 PDF 并完成识别</p>
        <a
          href="/"
          className="mt-4 inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          返回首页
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setMode("bilingual")}
            className={`px-4 py-1 rounded text-sm ${
              mode === "bilingual"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            左右对照
          </button>
          <button
            onClick={() => setMode("inline")}
            className={`px-4 py-1 rounded text-sm ${
              mode === "inline"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            紧跟模式
          </button>
        </div>
        <PdfViewer />
      </div>

      <div className="space-y-4 overflow-y-auto h-[calc(100vh-180px)]">
        {page.blocks.map((block) => (
          <div key={block.block_id} className="bg-white rounded-lg shadow p-4">
            <div className="text-base leading-relaxed font-medium">
              {block.original}
            </div>
            <div className="mt-2 text-base leading-relaxed text-blue-700 border-l-4 border-blue-400 pl-4">
              {block.translated || "待翻译..."}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
