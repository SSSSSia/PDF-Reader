import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore, effectiveZoom } from "../stores/uiStore";
import { useZoomWheel } from "../hooks/useZoomWheel";
import { usePdfDocument } from "../hooks/usePdfDocument";
import { useLazyPage, type PageLayout } from "../hooks/useLazyPage";
import MarkdownText from "./common/MarkdownText";
import BlockTranslateButton from "./common/BlockTranslateButton";
import FormulaButton from "./common/FormulaButton";
import type { TextBlock } from "../types";

type BBox = [number, number, number, number];
type Anchor = { block: TextBlock; bb: BBox };
type PageMeta = { layout: PageLayout | null; rotated: boolean };

/**
 * 原版PDF·左右对照（阶段7-T4）：左栏 pdfjs 原样渲染（懒渲染复用
 * usePdfDocument/useLazyPage，与点击翻译形态同源），右栏译文面板按
 * 「镜像几何」锚定——每页占位高度与左栏渲染结果一致（pageMeta 上报），
 * 命中 bbox 的译文卡 absolute 定位在首段 bbox top × scale，与原版位置
 * 垂直对齐（几何保证，误差 0）；bbox 缺失的块按文档顺序流入右栏尾部
 * 「未对齐译文」区，不丢失（任务回退设计）。
 *
 * 交互：双栏 scrollTop 1:1 双向同步（写相同值不触发 scroll 事件，事件链
 * 自然终止，无需防抖锁）；点击左栏高亮块 → 右栏对应译文卡 scrollIntoView。
 * 缩放：外层 wrapper 挂 useZoomWheel（原版组缺省 70%，阶段7-T2 语义），
 * 卡内字号随 zoom 线性缩放保持与版式的视觉比例。
 *
 * 已知限制（v1，验收后按反馈收敛）：①锚定卡 absolute 不撑开占位，译文
 * 显著长于原块时可能与下方卡片局部重叠（段落自上而下的顺序性使概率低）；
 * ②旋转页坐标会错位——锚定卡与左栏 overlay 一致地不渲染，该页译文暂缺。
 */
export default function OriginalBilingualPage() {
  const filePath = usePdfStore((s) => s.filePath);
  const pages = usePdfStore((s) => s.pages);
  const zoom = effectiveZoom(
    useUiStore((s) => s.zoom),
    useUiStore((s) => s.readerMode)
  );
  const zoomRef = useZoomWheel<HTMLDivElement>();
  const { pdf, error } = usePdfDocument(filePath);

  const leftPaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const [leftW, setLeftW] = useState(0);
  // block_id → 右栏译文卡元素（左栏高亮点击定位用）
  const cardRefs = useRef<Map<number, HTMLElement | null>>(new Map());
  const [pageMeta, setPageMeta] = useState<Map<number, PageMeta>>(new Map());

  // 左栏宽度跟踪（fit-width 基准；右栏镜像几何同源此值）
  useEffect(() => {
    const el = leftPaneRef.current;
    if (!el) return;
    const update = () => setLeftW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 每页布局上报（渲染完成/缩放重渲染后右栏占位同步）
  const onMeta = useCallback((pageNo: number, meta: PageMeta) => {
    setPageMeta((prev) => {
      const cur = prev.get(pageNo);
      if (cur && cur.layout === meta.layout && cur.rotated === meta.rotated)
        return prev;
      const next = new Map(prev);
      next.set(pageNo, meta);
      return next;
    });
  }, []);

  // 换文档（含多会话切换）时清空旧页高缓存，防右栏短暂用旧文档几何
  useEffect(() => {
    setPageMeta(new Map());
  }, [filePath]);

  // 锚定索引：块锚定到 bboxes 首段页坐标（跨页块只出一张卡，锚首段）；
  // bbox 缺失的块进 unanchored（按文档顺序，遍历顺序即文档顺序）
  const { anchorsByPage, unanchored } = useMemo(() => {
    const m = new Map<number, Anchor[]>();
    const un: TextBlock[] = [];
    pages.forEach((p) =>
      p.blocks.forEach((b) => {
        const first = b.bboxes?.length
          ? b.bboxes[0]
          : b.bbox
            ? { page: p.page, bbox: b.bbox as BBox }
            : null;
        if (first?.bbox) {
          const arr = m.get(first.page) ?? [];
          arr.push({ block: b, bb: first.bbox });
          m.set(first.page, arr);
        } else {
          un.push(b);
        }
      })
    );
    return { anchorsByPage: m, unanchored: un };
  }, [pages]);

  // 滚动同步：双栏 scrollTop 1:1 互写。写相同值不触发 scroll 事件，
  // 事件链自然终止；内容高度不同（右栏尾部更长）时由浏览器 clamp。
  const onLeftScroll = () => {
    const l = leftPaneRef.current;
    const r = rightPaneRef.current;
    if (!l || !r) return;
    if (r.scrollTop !== l.scrollTop) r.scrollTop = l.scrollTop;
  };
  const onRightScroll = () => {
    const l = leftPaneRef.current;
    const r = rightPaneRef.current;
    if (!l || !r) return;
    if (l.scrollTop !== r.scrollTop) l.scrollTop = r.scrollTop;
  };

  // 点击左栏高亮块 → 右栏对应译文卡滚动定位
  const focusCard = useCallback((blockId: number) => {
    cardRefs.current.get(blockId)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, []);

  const pageW = leftW > 0 ? (leftW - 48) * zoom : 0;
  const columnW = leftW > 0 ? (leftW - 48) * zoom + 32 : undefined;

  return (
    <div ref={zoomRef} className="h-[calc(100vh-170px)]">
      <div className="flex h-full flex-col gap-3 md:flex-row">
        {error && (
          <div
            role="alert"
            className="mx-auto mt-6 max-w-2xl self-start rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300"
          >
            原版渲染失败：{error}
          </div>
        )}
        {!pdf && !error && (
          <div className="py-20 text-center text-sm text-slate-500 dark:text-slate-400">
            正在加载 PDF…
          </div>
        )}

        {pdf && (
          <>
            {/* 左栏：原版渲染 + 高亮（点击定位右栏译文） */}
            <div
              ref={leftPaneRef}
              onScroll={onLeftScroll}
              className="relative min-w-0 flex-1 overflow-auto bg-slate-200 dark:bg-slate-950"
            >
              <div
                className="mx-auto px-4 pb-16 pt-3"
                style={{ width: columnW }}
              >
                {pages.map((p) => (
                  <SourcePage
                    key={p.page}
                    pdf={pdf}
                    pageNo={p.page + 1}
                    anchors={anchorsByPage.get(p.page) ?? []}
                    wrapW={leftW}
                    zoom={zoom}
                    onMeta={onMeta}
                    onJump={focusCard}
                  />
                ))}
              </div>
            </div>

            {/* 右栏：译文面板（镜像几何 + 锚定卡 + 未对齐尾部流） */}
            <div
              ref={rightPaneRef}
              onScroll={onRightScroll}
              className="relative min-w-0 flex-1 overflow-auto bg-slate-100 dark:bg-slate-900"
            >
              <div
                className="mx-auto px-4 pb-16 pt-3"
                style={{ width: columnW }}
              >
                {pages.map((p) => (
                  <MirrorPage
                    key={p.page}
                    pageNo={p.page + 1}
                    meta={pageMeta.get(p.page + 1) ?? null}
                    anchors={anchorsByPage.get(p.page) ?? []}
                    pageW={pageW}
                    zoom={zoom}
                    cardRefs={cardRefs}
                  />
                ))}
                {unanchored.length > 0 && (
                  <div className="mb-6 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
                    <div className="mb-2 text-xs font-medium text-slate-400 dark:text-slate-500">
                      未对齐译文（无坐标块，按文档顺序）
                    </div>
                    <div className="flex flex-col gap-2">
                      {unanchored.map((b) => (
                        <TranslateCard
                          key={b.block_id}
                          block={b}
                          zoom={zoom}
                          cardRefs={cardRefs}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 左栏单页：懒渲染 canvas + 高亮 overlay（点击 → 右栏定位）+ 布局上报 */
function SourcePage({
  pdf,
  pageNo,
  anchors,
  wrapW,
  zoom,
  onMeta,
  onJump,
}: {
  pdf: any;
  pageNo: number;
  anchors: Anchor[];
  wrapW: number;
  zoom: number;
  onMeta: (pageNo: number, meta: PageMeta) => void;
  onJump: (blockId: number) => void;
}) {
  const { holderRef, canvasRef, layout, rotated } = useLazyPage({
    pdf,
    pageNo,
    renderW: wrapW,
    zoom,
  });

  useEffect(() => {
    onMeta(pageNo, { layout, rotated });
  }, [pageNo, layout, rotated, onMeta]);

  return (
    <div
      ref={holderRef}
      className="relative mb-6"
      style={{ minHeight: layout ? layout.h + 28 : 920 }}
    >
      <div
        className="relative mx-auto bg-white shadow-md dark:shadow-black/50"
        style={{ width: layout ? layout.w : undefined }}
      >
        <canvas ref={canvasRef} className="block" />

        {layout && !rotated && (
          <div className="absolute inset-0">
            {anchors.map((a, i) => {
              const bb = a.bb;
              const s = layout.scale;
              const has = !!a.block.translated;
              return (
                <div
                  key={`${a.block.block_id}-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onJump(a.block.block_id)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && onJump(a.block.block_id)
                  }
                  className={`absolute cursor-pointer rounded-[3px] transition-colors duration-100 ${
                    has
                      ? "bg-blue-500/10 hover:bg-blue-500/30"
                      : "bg-slate-400/5 hover:bg-slate-400/30"
                  }`}
                  style={{
                    left: bb[0] * s,
                    top: bb[1] * s,
                    width: Math.max(2, (bb[2] - bb[0]) * s),
                    height: Math.max(2, (bb[3] - bb[1]) * s),
                  }}
                  title={has ? "点击在右侧定位译文" : "未翻译"}
                />
              );
            })}
          </div>
        )}

        {rotated && (
          <div className="absolute left-2 top-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
            旋转页暂不支持坐标对照
          </div>
        )}
      </div>
      <div className="mt-1.5 text-center text-xs text-slate-400 dark:text-slate-500">
        第 {pageNo} 页
      </div>
    </div>
  );
}

/** 右栏单页：镜像占位（高度=左栏渲染结果）+ 锚定译文卡 */
function MirrorPage({
  pageNo,
  meta,
  anchors,
  pageW,
  zoom,
  cardRefs,
}: {
  pageNo: number;
  meta: PageMeta | null;
  anchors: Anchor[];
  pageW: number;
  zoom: number;
  cardRefs: { current: Map<number, HTMLElement | null> };
}) {
  const layout = meta?.layout ?? null;
  const rotated = meta?.rotated ?? false;
  const scale = layout?.scale ?? null;
  const sorted = useMemo(
    () => [...anchors].sort((a, b) => a.bb[1] - b.bb[1]),
    [anchors]
  );

  return (
    <div
      className="relative mb-6"
      style={{ minHeight: layout ? layout.h + 28 : 920 }}
    >
      <div
        className="relative mx-auto"
        style={{ width: layout ? pageW : undefined, height: layout ? layout.h : undefined }}
      >
        {!rotated && scale != null && (
          sorted.map((a) => {
            const s = scale;
            return (
              <div
                key={a.block.block_id}
                ref={(el) => {
                  cardRefs.current.set(a.block.block_id, el);
                }}
                className="absolute left-0 right-0 rounded-lg border border-slate-200 bg-white/95 shadow-sm dark:border-slate-700 dark:bg-slate-900/95"
                style={{ top: a.bb[1] * s, fontSize: `${0.875 * zoom}rem` }}
              >
                <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                    译文
                  </span>
                  {/* 公式块只出「式」（识别成功自动重译），其余「译/重译」 */}
                  {a.block.formula_hint ? (
                    <FormulaButton block={a.block} />
                  ) : (
                    <BlockTranslateButton block={a.block} />
                  )}
                </div>
                <div className="px-2.5 pb-2 pt-0.5 leading-relaxed text-slate-900 dark:text-slate-100">
                  {a.block.translated ? (
                    <MarkdownText text={a.block.translated} />
                  ) : (
                    <span className="italic text-slate-400 dark:text-slate-500">
                      待翻译…
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        {rotated && (
          <div className="absolute left-2 top-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
            旋转页暂不支持坐标对照
          </div>
        )}
      </div>
      <div className="mt-1.5 text-center text-xs text-slate-400 dark:text-slate-500">
        第 {pageNo} 页
      </div>
    </div>
  );
}

/** 译文卡（锚定卡与未对齐尾部共用形态） */
function TranslateCard({
  block,
  zoom,
  cardRefs,
}: {
  block: TextBlock;
  zoom: number;
  cardRefs: { current: Map<number, HTMLElement | null> };
}) {
  return (
    <div
      ref={(el) => {
        cardRefs.current.set(block.block_id, el);
      }}
      className="rounded-lg border border-slate-200 bg-white/95 shadow-sm dark:border-slate-700 dark:bg-slate-900/95"
      style={{ fontSize: `${0.875 * zoom}rem` }}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          译文
        </span>
        {block.formula_hint ? (
          <FormulaButton block={block} />
        ) : (
          <BlockTranslateButton block={block} />
        )}
      </div>
      <div className="px-2.5 pb-2 pt-0.5 leading-relaxed text-slate-900 dark:text-slate-100">
        {block.translated ? (
          <MarkdownText text={block.translated} />
        ) : (
          <span className="italic text-slate-400 dark:text-slate-500">
            待翻译…
          </span>
        )}
      </div>
    </div>
  );
}
