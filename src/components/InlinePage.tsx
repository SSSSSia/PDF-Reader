import { Link } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import MarkdownText from "./common/MarkdownText";
import ReaderToolbar from "./ReaderToolbar";

/**
 * 紧跟模式：整篇连续文档流（无分页，对标 Scholaread，用户决策 2026-09-06）——
 * 原文段落在上，译文紧贴其下，段落间虚线分隔，图片/表格按原文档顺序穿插。
 * content-visibility:auto 保证长文档滚动性能。
 */
/** 纯图片块（markdown 图片引用），不与译文配对，整块原样展示 */
const isPureImage = (t: string) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(t);

export default function InlinePage() {
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

      {/* 整篇连续文档流：所有页的 block 按文档顺序排布 */}
      <div className="h-[calc(100vh-170px)] overflow-y-auto">
        <div className="mx-auto max-w-4xl px-2 pb-16">
          {blocks.map((b) => (
            <div
              key={`${b.page}-${b.block_id}`}
              className="mb-5"
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" }}
            >
              {isPureImage(b.original) ? (
                /* 图表块：只出现一次，优先显示译制图（原排版+图内文字译文），
                   未生成完成时回退原图；下方图注块照常原文+译文对照 */
                <figure className="my-6 flex flex-col items-center">
                  <MarkdownText text={b.translated || b.original} />
                </figure>
              ) : (
                <>
                  <div className="text-slate-900 dark:text-slate-100 paper-font text-justify">
                    <MarkdownText text={b.original} />
                  </div>
                  {b.translated && (
                    <div className="mt-1.5 border-b border-dashed border-slate-300 pb-2 text-slate-600 dark:border-slate-600 dark:text-slate-300 paper-font text-justify">
                      <MarkdownText text={b.translated} />
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
