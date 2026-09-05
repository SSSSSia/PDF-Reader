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

  const showThumbs = numPages > 0 && Object.keys(thumbs).length > 0;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* 顶部：页码 + 上/下页 */}
      <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
        <button
          className="btn-secondary !px-2.5 !py-1"
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
            aria-label="当前页码"
            className="mx-1.5 w-14 rounded-md border border-slate-300 px-1 py-0.5 text-center tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          / {total} 页
        </span>
        <button
          className="btn-secondary !px-2.5 !py-1"
          onClick={() => goto(currentPage + 1)}
          disabled={currentPage >= total - 1}
        >
          下一页
        </button>
        {loading && (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            缩略图生成中…
          </span>
        )}
      </div>

      {/* 缩略图导航条（横向滚动） */}
      {showThumbs && (
        <div className="flex max-h-[140px] gap-2 overflow-x-auto pb-1.5">
          {Array.from({ length: numPages }, (_, i) => {
            const t = thumbs[i];
            const active = i === currentPage;
            return (
              <button
                key={i}
                onClick={() => goto(i)}
                aria-label={`跳转到第 ${i + 1} 页`}
                aria-current={active ? "true" : undefined}
                className={`relative shrink-0 overflow-hidden rounded-md bg-white transition-shadow duration-150 ${
                  active
                    ? "ring-2 ring-blue-500"
                    : "ring-1 ring-slate-200 hover:ring-slate-400 dark:ring-slate-600 dark:hover:ring-slate-400"
                }`}
                style={{ width: 90 }}
                title={`第 ${i + 1} 页`}
              >
                {t?.url ? (
                  <img
                    src={t.url}
                    alt=""
                    style={{ width: 90, height: "auto", display: "block" }}
                  />
                ) : (
                  <div
                    className="animate-pulse bg-slate-100 dark:bg-slate-700"
                    style={{ width: 90, height: 120 }}
                  />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-slate-900/60 py-0.5 text-center text-[10px] tabular-nums text-white">
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
