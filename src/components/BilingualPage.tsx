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
 * 左右对照模式：整篇连续滚动（无分页，对标 Scholaread，用户决策 2026-09-06）。
 * 对齐采用网格行配对——每一行 = 一个 block 的「原文 | 译文」，
 * DOM 结构保证左右严格同行（阶段3-T1 提前落地），滚动天然同步，
 * 不再需要旧的百分比滚动同步（useScrollSync 已退役）。
 * content-visibility:auto 让长文档只渲染视口附近内容，滚动性能不随页数劣化。
 * 阶段7-T1：根容器挂 Ctrl+滚轮全局缩放（hook），内容区经 --reader-zoom
 * 缩放 prose 根字号（工具栏/页签为 chrome 不缩放；原版分支由 pdfjs scale 走）。
 */
export default function BilingualPage() {
  const { pages, isLoading, progress, error } = usePdfStore();
  const readerMode = useUiStore((s) => s.readerMode);
  // 阶段7-T2：用户未手动设置过缩放（null）时，重排版缺省 100%（排版基准）
  const zoom = useUiStore((s) => s.zoom) ?? 1;
  const zoomRef = useZoomWheel<HTMLDivElement>();
  const blocks = pages.flatMap((p) => p.blocks);

  // 纯图片块（图表快照）：后端已令译文=原文，前端整行居中渲染一次
  const isPureImage = (t: string) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(t);

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
      /* 整篇单列滚动：所有页的 block 按文档顺序连续排布 */
      <div className="h-[calc(100vh-170px)] overflow-y-auto">
        <div
          className="mx-auto max-w-6xl"
          style={{ "--reader-zoom": zoom } as CSSProperties}
        >
          {/* 窄窗口降级为单列（阶段3-T1 残余）：原文在上、译文在下 */}
          <div className="sticky top-0 z-10 hidden grid-cols-2 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95 md:grid">
            <div className="py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              原文
            </div>
            <div className="py-2 text-xs font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-400">
              译文
            </div>
          </div>

          {blocks.map((b) =>
            isPureImage(b.original) ? (
              <div
                key={`${b.page}-${b.block_id}`}
                className="grid grid-cols-1 gap-y-2 border-b border-dashed border-slate-200 dark:border-slate-700 md:grid-cols-2 md:gap-x-8"
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 260px" }}
              >
                <div className="py-3 pr-2">
                  {/* 原文栏不显示「译」按钮：只有译文栏可生成译制图（用户反馈 2026-09-08） */}
                  <TranslatableImage md={b.original} interactive={false} />
                </div>
                <div className="py-3 md:border-l md:border-slate-200 md:pl-2 dark:md:border-slate-700">
                  {/* 图表默认右栏也显示原图；表格可点按生成译制图 */}
                  <TranslatableImage md={b.translated || b.original} />
                </div>
              </div>
            ) : (
              <div
                key={`${b.page}-${b.block_id}`}
                className="grid grid-cols-1 border-b border-dashed border-slate-200 dark:border-slate-700 md:grid-cols-2 md:gap-x-8"
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}
              >
                <div className="paper-font group relative py-3 pr-2 text-justify text-slate-900 dark:text-slate-100">
                  {/* 悬停浮现的单块翻译/重翻按钮（2026-09-07 用户需求）；
                      公式块（含纯公式/混合）只出「式」——识别成功后纯公式
                      直出 LaTeX，混合块替换原文并自动重译（管线翻译完成后
                      也会自动跑一遍，按钮作手动重试入口，2026-09-08） */}
                  <span className="absolute right-1 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {b.formula_hint ? (
                      <FormulaButton block={b} />
                    ) : (
                      <BlockTranslateButton block={b} />
                    )}
                  </span>
                  <MarkdownText text={b.original} />
                </div>
                <div className="paper-font py-3 text-justify text-blue-900 dark:text-blue-100 md:border-l md:border-slate-200 md:pl-2 dark:md:border-slate-700">
                  {b.translated ? (
                    <>
                      {/* 单列模式下给译文加个小标签，区分原文 */}
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-blue-500 md:hidden dark:text-blue-400">
                        译文
                      </span>
                      <MarkdownText text={b.translated} />
                    </>
                  ) : (
                    <span className="italic text-slate-400 dark:text-slate-500">
                      待翻译…
                    </span>
                  )}
                </div>
              </div>
            ),
          )}

          <div className="h-16" aria-hidden="true" />
        </div>
      </div>
      )}
    </div>
  );
}
