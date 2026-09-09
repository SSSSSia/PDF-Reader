/**
 * 原版PDF·左右对照 占位（阶段7-T3）：original_bilingual 的 UI 入口已就位，
 * 内容组件由阶段7-T4 实现（左 pdfjs 渲染 + 右译文面板 + bbox 锚定 + 滚动同步）。
 * T4 落地时将 BilingualPage/InlinePage 对本组件的引用替换为 OriginalBilingualPage。
 */
export default function OriginalBilingualPlaceholder() {
  return (
    <div className="py-20 text-center">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-2xl dark:bg-slate-800"
        aria-hidden="true"
      >
        📄
      </div>
      <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
        原版PDF · 左右对照
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        开发中（阶段7-T4）：原版版式左栏 + 译文右栏对齐阅读
      </p>
    </div>
  );
}
