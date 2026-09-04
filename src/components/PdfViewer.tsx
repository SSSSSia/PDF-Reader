import { usePdfStore } from "../stores/pdfStore";
import { usePdfThumbnails } from "../hooks/usePdfThumbnails";

/**
 * 页面导航器（决策 D4：分页 + 缩略图导航）。
 *
 * 优先用 pdfjs-dist 渲染真实 PDF 页面缩略图（用户已批准引入该依赖），
 * 若 pdfjs 不可用（如纯浏览器环境未完成 Tauri 集成）则降级为页码切换。
 */
export default function PdfViewer() {
  const { pages, currentPage, setCurrentPage } = usePdfStore();
  const total = pages.length;
  const { thumbs, numPages, loading } = usePdfThumbnails();

  if (total === 0) return null;

  const goto = (page: number) =>
    setCurrentPage(Math.min(Math.max(page, 0), total - 1));

  const btn =
    "px-3 py-1 rounded text-sm border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50";

  const showThumbs = numPages > 0 && Object.keys(thumbs).length > 0;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* 顶部：页码 + 上/下页 */}
      <div className="flex items-center gap-3 text-sm text-gray-700">
        <button
          className={btn}
          onClick={() => goto(currentPage - 1)}
          disabled={currentPage <= 0}
        >
          上一页
        </button>
        <span className="whitespace-nowrap">
          第
          <input
            type="number"
            min={1}
            max={total}
            value={currentPage + 1}
            onChange={(e) => goto(Number(e.target.value) - 1)}
            className="mx-1 w-14 text-center border rounded px-1 py-0.5"
          />
          / {total} 页
        </span>
        <button
          className={btn}
          onClick={() => goto(currentPage + 1)}
          disabled={currentPage >= total - 1}
        >
          下一页
        </button>
        {loading && (
          <span className="text-gray-400 text-xs">缩略图生成中…</span>
        )}
      </div>

      {/* 缩略图导航条（横向滚动） */}
      {showThumbs && (
        <div className="flex gap-2 overflow-x-auto pb-2 max-h-[140px]">
          {Array.from({ length: numPages }, (_, i) => {
            const t = thumbs[i];
            const active = i === currentPage;
            return (
              <button
                key={i}
                onClick={() => goto(i)}
                className={`relative shrink-0 rounded border-2 overflow-hidden bg-white transition-colors ${
                  active
                    ? "border-blue-600 ring-2 ring-blue-200"
                    : "border-gray-200 hover:border-gray-400"
                }`}
                style={{ width: 90 }}
                title={`第 ${i + 1} 页`}
              >
                {t?.url ? (
                  <img
                    src={t.url}
                    alt={`第 ${i + 1} 页`}
                    style={{ width: 90, height: "auto", display: "block" }}
                  />
                ) : (
                  <div
                    className="bg-gray-100 animate-pulse"
                    style={{ width: 90, height: 120 }}
                  />
                )}
                <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] py-0.5 text-center">
                  {i + 1}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
