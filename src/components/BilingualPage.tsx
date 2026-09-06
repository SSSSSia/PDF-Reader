import { Link } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import MarkdownText from "./common/MarkdownText";
import ReaderToolbar from "./ReaderToolbar";

/**
 * 左右对照模式：整篇连续滚动（无分页，对标 Scholaread，用户决策 2026-09-06）。
 * 对齐采用网格行配对——每一行 = 一个 block 的「原文 | 译文」，
 * DOM 结构保证左右严格同行（阶段3-T1 提前落地），滚动天然同步，
 * 不再需要旧的百分比滚动同步（useScrollSync 已退役）。
 * content-visibility:auto 让长文档只渲染视口附近内容，滚动性能不随页数劣化。
 */
export default function BilingualPage() {
  const { pages, isLoading, progress, error } = usePdfStore();
  const blocks = pages.flatMap((p) => p.blocks);

  if (blocks.length === 0) {
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

      {/* 整篇单列滚动：所有页的 block 按文档顺序连续排布 */}
      <div className="h-[calc(100vh-170px)] overflow-y-auto">
        <div className="mx-auto max-w-6xl">
          <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
            <div className="py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              原文
            </div>
            <div className="py-2 text-xs font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-400">
              译文
            </div>
          </div>

          {blocks.map((b) => (
            <div
              key={`${b.page}-${b.block_id}`}
              className="grid grid-cols-2 gap-x-8 border-b border-dashed border-slate-200 dark:border-slate-700"
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}
            >
              <div className="py-3 pr-2 text-slate-900 dark:text-slate-100">
                <MarkdownText text={b.original} />
              </div>
              <div className="border-l border-slate-200 py-3 pl-2 text-blue-900 dark:border-slate-700 dark:text-blue-100">
                {b.translated ? (
                  <MarkdownText text={b.translated} />
                ) : (
                  <span className="italic text-slate-400 dark:text-slate-500">
                    待翻译…
                  </span>
                )}
              </div>
            </div>
          ))}

          <div className="h-16" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
