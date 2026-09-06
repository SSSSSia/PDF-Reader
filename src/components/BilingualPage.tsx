import { Link } from "react-router-dom";
import { useRef } from "react";
import { usePdfStore } from "../stores/pdfStore";
import { useScrollSync } from "../hooks/useScrollSync";
import { useUiStore } from "../stores/uiStore";
import MarkdownText from "./common/MarkdownText";
import ReaderToolbar from "./ReaderToolbar";

export default function BilingualPage() {
  const { pages, currentPage, isLoading, progress, error } = usePdfStore();
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const { handleScroll } = useScrollSync(leftRef, rightRef);

  // 按分页索引取当前页（修复 R2：原先只渲染 pages[0]）
  const page = pages[currentPage];

  // 阶段1-T2：不再用 isLoading 全屏遮罩——翻译中原文照常可读，
  // 译文占位「待翻译...」由下方 block 渲染承担，顶部进度条非阻塞提示进度。
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

      {/* <md 单栏堆叠（浏览器窄窗口）；md+ 双栏对照（Tauri 最小窗宽 900px 恒为双栏） */}
      <div className="grid h-[calc(100vh-170px)] grid-cols-1 gap-x-6 gap-y-4 overflow-auto md:grid-cols-2">
        <div
          ref={leftRef}
          className="space-y-3 overflow-y-auto pr-2"
          onScroll={() => handleScroll("left")}
        >
          <h3 className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
            原文
          </h3>
          {page.blocks.map((block) => (
            <div
              key={block.block_id}
              className="rounded-lg border border-slate-200 bg-white p-3.5 transition-colors duration-150 dark:border-slate-700 dark:bg-slate-800"
              style={{
                minHeight: `${Math.max(50, block.original.length * 0.8)}px`,
              }}
            >
              <MarkdownText text={block.original} />
            </div>
          ))}
        </div>
        <div
          ref={rightRef}
          className="space-y-3 overflow-y-auto pl-2"
          onScroll={() => handleScroll("right")}
        >
          <h3 className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 py-2 text-xs font-semibold uppercase tracking-wide text-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-400">
            译文
          </h3>
          {page.blocks.map((block) => (
            <div
              key={block.block_id}
              className="rounded-lg border border-blue-100 bg-white p-3.5 text-blue-900 transition-colors duration-150 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-100"
              style={{
                minHeight: `${Math.max(50, block.translated.length * 0.8)}px`,
              }}
            >
              {block.translated ? (
                <MarkdownText text={block.translated} />
              ) : (
                <span className="italic text-slate-400 dark:text-slate-500">
                  待翻译...
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
