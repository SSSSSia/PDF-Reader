import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { useZoomWheel } from "../hooks/useZoomWheel";
import MarkdownText from "./common/MarkdownText";
import TranslatableImage from "./common/TranslatableImage";
import BlockTranslateButton from "./common/BlockTranslateButton";
import FormulaButton from "./common/FormulaButton";
import ReaderToolbar from "./ReaderToolbar";
import ReaderTabs from "./ReaderTabs";
import OriginalReader from "./OriginalReader";
import OriginalBilingualPage from "./OriginalBilingualPage";
import OriginalReplacePage from "./OriginalReplacePage";

/**
 * 紧跟模式：整篇连续文档流（无分页，对标 Scholaread，用户决策 2026-09-06）——
 * 原文段落在上，译文紧贴其下，段落间虚线分隔，图片/表格按原文档顺序穿插。
 * content-visibility:auto 保证长文档滚动性能。
 * 阶段7-T1：根容器挂 Ctrl+滚轮全局缩放（hook），内容区经 --reader-zoom
 * 缩放 prose 根字号（工具栏/页签为 chrome 不缩放；原版分支由 pdfjs scale 走）。
 */
/** 纯图片块（markdown 图片引用），不与译文配对，整块原样展示 */
const isPureImage = (t: string) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(t);

export default function InlinePage() {
  const { pages, isLoading, progress, error } = usePdfStore();
  const readerMode = useUiStore((s) => s.readerMode);
  // 阶段7-T2：用户未手动设置过缩放（null）时，重排版缺省 100%（排版基准）
  const zoom = useUiStore((s) => s.zoom) ?? 1;
  const zoomRef = useZoomWheel<HTMLDivElement>();
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
    <div ref={zoomRef}>
      <ReaderToolbar />
      <ReaderTabs />

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

      {/* 原版PDF 组（阶段7-T3 分组）：点击翻译=pdfjs 原样渲染 + 块坐标译文浮层；
          左右对照=T4 左渲染右译文锚定对照；原文替换=T6 bbox 原地盖译文层 */}
      {readerMode === "original_click" ? (
        <OriginalReader />
      ) : readerMode === "original_bilingual" ? (
        <OriginalBilingualPage />
      ) : readerMode === "original_replace" ? (
        <OriginalReplacePage />
      ) : (
      /* 整篇连续文档流：所有页的 block 按文档顺序排布 */
      <div className="h-[calc(100vh-170px)] overflow-y-auto">
        <div
          className="mx-auto max-w-4xl px-2 pb-16"
          style={{ "--reader-zoom": zoom } as CSSProperties}
        >
          {blocks.map((b) => (
            <div
              key={`${b.page}-${b.block_id}`}
              className="mb-5"
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" }}
            >
              {isPureImage(b.original) ? (
                /* 图表块：只出现一次，默认原图；表格图带「译」按钮可按需
                   生成译制图（原排版+表内文字译文），下方图注走正文对照 */
                <figure className="my-6 flex flex-col items-center">
                  <TranslatableImage md={b.translated || b.original} />
                </figure>
              ) : (
                <>
                  <div className="text-slate-900 dark:text-slate-100 paper-font text-justify group relative">
                    {/* 悬停浮现的单块按钮（2026-09-07）：公式块只出「式」
                        （识别成功自动重译，2026-09-08），其余「译/重译」 */}
                    <span className="absolute right-0 top-0 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {b.formula_hint ? (
                        <FormulaButton block={b} />
                      ) : (
                        <BlockTranslateButton block={b} />
                      )}
                    </span>
                    <MarkdownText text={b.original} />
                  </div>
                  {b.translated && (
                    <div className="mt-1.5 border-b border-dashed border-slate-300 pb-2 text-blue-900 dark:border-slate-600 dark:text-blue-100 paper-font text-justify">
                      <MarkdownText text={b.translated} />
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
