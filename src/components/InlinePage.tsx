import { Link } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import MarkdownText from "./common/MarkdownText";
import ReaderToolbar from "./ReaderToolbar";

/**
 * 紧跟模式：连续文档流排版（对标 Scholaread）——
 * 原文段落在上，译文紧贴其下，段落间用虚线分隔，无卡片框，
 * 图片/表格按原文档顺序穿插在排版流中。
 */
export default function InlinePage() {
  const { pages, currentPage, isLoading, progress, error } = usePdfStore();

  // 按分页索引取当前页（修复 R2：原先只渲染 pages[0]）
  const page = pages[currentPage];

  // 阶段1-T2：不再用 isLoading 全屏遮罩——翻译中原文照常可读，
  // 译文虚线区随翻译进度逐段出现。
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

      {/* 翻译进行中：非阻塞进度条（原文已可读，译文逐段流入） */}
      {isLoading && (
        <div className="mb-3" role="status" aria-label="翻译进度">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>正在翻译，已完成的段落实时显示…</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div
            className="w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            style={{ height: 4 }}
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
          className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </div>
      )}

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
