import { useRef } from "react";
import { usePdfStore } from "../stores/pdfStore";
import { useScrollSync } from "../hooks/useScrollSync";
import { useUiStore } from "../stores/uiStore";
import LoadingSpinner from "./common/LoadingSpinner";
import PdfViewer from "./PdfViewer";

export default function BilingualPage() {
  const { pages, currentPage, isLoading } = usePdfStore();
  const { mode, setMode } = useUiStore();
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const { handleScroll } = useScrollSync(leftRef, rightRef);

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

      {mode === "bilingual" ? (
        <div className="grid grid-cols-2 gap-4 gap-x-6 h-[calc(100vh-180px)] overflow-auto">
          <div
            ref={leftRef}
            className="space-y-3 pr-2 overflow-y-auto"
            onScroll={() => handleScroll("left")}
          >
            <h3 className="text-sm font-semibold text-gray-600 sticky top-0 bg-white py-1 z-10">
              原文
            </h3>
            {page.blocks.map((block) => (
              <div
                key={block.block_id}
                className="p-3 bg-white rounded border text-base leading-relaxed"
                style={{
                  minHeight: `${Math.max(50, block.original.length * 0.8)}px`,
                }}
              >
                {block.original}
              </div>
            ))}
          </div>
          <div
            ref={rightRef}
            className="space-y-3 pl-2 overflow-y-auto"
            onScroll={() => handleScroll("right")}
          >
            <h3 className="text-sm font-semibold text-gray-600 sticky top-0 bg-white py-1 z-10">
              译文
            </h3>
            {page.blocks.map((block) => (
              <div
                key={block.block_id}
                className="p-3 bg-white rounded border text-base leading-relaxed text-blue-700"
                style={{
                  minHeight: `${Math.max(50, block.translated.length * 0.8)}px`,
                }}
              >
                {block.translated || "待翻译..."}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4 overflow-y-auto h-[calc(100vh-180px)]">
          {page.blocks.map((block) => (
            <div key={block.block_id} className="bg-white rounded-lg shadow p-4">
              <div className="text-base leading-relaxed mb-3">
                {block.original}
              </div>
              <div className="text-base leading-relaxed text-blue-700 border-l-4 border-blue-400 pl-4">
                {block.translated || "待翻译..."}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
