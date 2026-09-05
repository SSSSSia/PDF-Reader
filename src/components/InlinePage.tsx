import { Link } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import LoadingSpinner from "./common/LoadingSpinner";
import MarkdownText from "./common/MarkdownText";
import ReaderToolbar from "./ReaderToolbar";

/**
 * 紧跟模式：连续文档流排版（对标 Scholaread）——
 * 原文段落在上，译文紧贴其下，段落间用虚线分隔，无卡片框，
 * 图片/表格按原文档顺序穿插在排版流中。
 */
export default function InlinePage() {
  const { pages, currentPage, isLoading } = usePdfStore();

  // 按分页索引取当前页（修复 R2：原先只渲染 pages[0]）
  const page = pages[currentPage];

  if (isLoading) return <LoadingSpinner text="加载中..." />;
  if (!page) {
    return (
      <div className="py-20 text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-2xl dark:bg-slate-800"
          aria-hidden="true"
        >
          📄
        </div>
        <p className="mb-4 text-slate-600 dark:text-slate-300">
          请先上传 PDF 并完成识别
        </p>
        <Link to="/" className="btn-primary">
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div>
      <ReaderToolbar />

      <div className="h-[calc(100vh-170px)] overflow-y-auto">
        <div className="mx-auto max-w-4xl px-2 pb-16">
          {page.blocks.map((block) => (
            <div key={block.block_id} className="mb-5">
              <div className="text-slate-900 dark:text-slate-100">
                <MarkdownText text={block.original} />
              </div>
              {block.translated && (
                <div className="mt-1.5 border-b border-dashed border-slate-300 pb-2 text-slate-600 dark:border-slate-600 dark:text-slate-300">
                  <MarkdownText text={block.translated} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
