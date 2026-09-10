import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
 * 已知限制（v1，验收后按反馈收敛）：①译文卡常比原块高（中译文字量+卡内
 * 边距），严格逐块对应物理上不可行——采用「首卡严格贴锚点 + 后卡顺序级联
 * （零重叠，间距仅 4px）+ 卡片极限瘦身（无标签行/悬停按钮/紧凑行高）延缓
 * 漂移」策略，漂移程度取决于译文长度，属信息量差异的固有约束；②旋转页
 * 坐标会错位——锚定卡与左栏 overlay 一致地不渲染，该页译文暂缺。
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
  // 复合键 page:block_id —— block_id 是后端每页 enumerate 的页内索引，
  // 裸用作全局键会跨页碰撞：cardRefs 恒被最后挂载的同号卡覆盖（点击定位
  // 永远滚到文档尾部）、hover 跨页误高亮（2026-09-10 用户反馈根因）
  const keyOf = (b: { page: number; block_id: number }) =>
    `${b.page}:${b.block_id}`;
  const cardRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  // 双向 hover 联动：悬停右栏卡 ↔ 左栏对应原文块同步加深（位置对应可视化）
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pageMeta, setPageMeta] = useState<Map<number, PageMeta>>(new Map());

  // 左栏宽度跟踪（fit-width 基准；右栏镜像几何同源此值）。
  // 依赖必须带 pdf：面板 div 在 {pdf && ...} 分支内，挂载时 pdf 未就绪
  // 则 ref 为 null——只跑一次的 effect 会永久丢失 ResizeObserver 绑定，
  // leftW 恒 0 → canvas 永不渲染、pageMeta 永不上报（右栏一片空白的
  // 根因，2026-09-09 用户验收反馈，浏览器实测 canvas 全为默认 300×150）
  useEffect(() => {
    const el = leftPaneRef.current;
    if (!el) return;
    const update = () => setLeftW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf]);

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
  const focusCard = useCallback((key: string) => {
    cardRefs.current.get(key)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, []);

  const pageW = leftW > 0 ? (leftW - 48) * zoom : 0;
  const columnW = leftW > 0 ? (leftW - 48) * zoom + 32 : undefined;

  return (
    <div
      ref={zoomRef}
      className="flex min-h-0 flex-1 flex-col"
      /* 译文字号策略（2026-09-10 用户决策"字号跟随原块"）：每段字号按原块
         渲染几何估算（见 MirrorPage segFont），随 zoom 与原版同步缩放——
         BabelDOC 式视觉对位；根值 0.75 仅为未命中段的兜底 */
      style={{ "--reader-zoom": 0.75 } as React.CSSProperties}
    >
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
                    hoveredId={hoveredId}
                    setHoveredId={setHoveredId}
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
                    hoveredId={hoveredId}
                    setHoveredId={setHoveredId}
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
                          key={keyOf(b)}
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

/** 左栏单页：懒渲染 canvas + 高亮 overlay（点击/悬停 ↔ 右栏联动）+ 布局上报 */
function SourcePage({
  pdf,
  pageNo,
  anchors,
  wrapW,
  zoom,
  onMeta,
  onJump,
  hoveredId,
  setHoveredId,
}: {
  pdf: any;
  pageNo: number;
  anchors: Anchor[];
  wrapW: number;
  zoom: number;
  onMeta: (pageNo: number, meta: PageMeta) => void;
  onJump: (key: string) => void;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
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
              const key = `${a.block.page}:${a.block.block_id}`;
              const hovered = hoveredId === key;
              return (
                <div
                  key={`${a.block.block_id}-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onJump(key)}
                  onKeyDown={(e) => e.key === "Enter" && onJump(key)}
                  onMouseEnter={() => has && setHoveredId(key)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`absolute cursor-pointer rounded-[3px] transition-colors duration-100 ${
                    hovered
                      ? "bg-blue-500/40 ring-1 ring-blue-500"
                      : has
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

/** 右栏单页：镜像占位（高度=左栏渲染结果）+ 流式锚定译文卡 */
function MirrorPage({
  pageNo,
  meta,
  anchors,
  pageW,
  zoom,
  cardRefs,
  hoveredId,
  setHoveredId,
}: {
  pageNo: number;
  meta: PageMeta | null;
  anchors: Anchor[];
  pageW: number;
  zoom: number;
  cardRefs: { current: Map<string, HTMLElement | null> };
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
}) {
  const layout = meta?.layout ?? null;
  const rotated = meta?.rotated ?? false;
  const scale = layout?.scale ?? null;
  // 阅读顺序：双栏页必须「先左栏后右栏」——纯 y 排序会把左右栏段落交错
  // 串行。判定必须严：只有**窄块明显分居左右两半**才是双栏；单栏页全宽块
  // 的 x 中点恰在中线附近，若按中点分栏会随机把底部块分进左组导致乱序
  // （实测 TOG「1 引言」跑到首位的根因）。双栏页内全宽块（标题/摘要）按 y
  // 作带分隔，带内窄块先左栏后右栏。
  const ordered = useMemo(() => {
    const byY = [...anchors].sort((a, b) => a.bb[1] - b.bb[1]);
    if (byY.length < 4) return byY;
    const pageWpt = Math.max(...byY.map((a) => a.bb[2]));
    const mid = pageWpt / 2;
    const tol = pageWpt * 0.05;
    const narrow = (a: Anchor) => a.bb[2] - a.bb[0] < pageWpt * 0.6;
    const inLeft = (a: Anchor) => narrow(a) && a.bb[2] <= mid + tol;
    const inRight = (a: Anchor) => narrow(a) && a.bb[0] >= mid - tol;
    const hasLeft = byY.some(inLeft);
    const hasRight = byY.some(inRight);
    if (!hasLeft || !hasRight) return byY;
    const cmp = (p: Anchor, q: Anchor) => p.bb[1] - q.bb[1];
    const out: Anchor[] = [];
    let L: Anchor[] = [];
    let R: Anchor[] = [];
    const flush = () => {
      out.push(...L.sort(cmp), ...R.sort(cmp));
      L = [];
      R = [];
    };
    for (const a of byY) {
      if (inLeft(a)) L.push(a);
      else if (inRight(a)) R.push(a);
      else {
        flush();
        out.push(a);
      }
    }
    flush();
    return out;
  }, [anchors]);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [heights, setHeights] = useState<number[]>([]);

  // 测量各卡实际渲染高度（译文内容/缩放变化后重测）——游标锚定的间距依据
  useLayoutEffect(() => {
    setHeights(ordered.map((_, i) => itemRefs.current[i]?.offsetHeight ?? 0));
  }, [ordered, scale, zoom, layout?.h]);

  // 游标软锚定（绝对定位版）：top = max(锚点y, 上一段底边+间距)。段落起点
  // 大致对应原文（软约束），前段超高时后段顺延、零重叠；无"卡片框"暴露
  // 漂移，位置感知主要靠结构镜像（mockup 2026-09-10 用户确认）。
  // 高度首帧未知（0）按纯锚点摆，测完一帧内修正（useLayoutEffect 无闪烁）。
  let cursorY = 0;
  const placed = ordered.map((a, i) => {
    const anchorY = scale != null ? a.bb[1] * scale : 0;
    // 短块（标题/节标题）前留稍大间距，模拟论文的节间节奏
    const gap = (a.block.original?.trim().length ?? 0) < 50 ? 10 : 5;
    const top = i > 0 ? Math.max(anchorY, cursorY + gap) : anchorY;
    cursorY = top + (heights[i] ?? 0);
    return { a, top, i };
  });
  // 字号跟随原块（2026-09-10 用户决策）：由原块几何反解字号——行数模型
  // lines = len×0.55×fontSize / blockW，块高 = lines×fontSize×1.25，联立得
  // fontSize = √(块高×blockW / (0.55×1.25×len))。锚点坐标已含 zoom 缩放，
  // 字号随 zoom 与原版同步放大（BabelDOC 行为）；公式块走 KaTeX 固定字号。
  // clamp 收窄到 9-13px（2026-09-10 用户反馈 Scholaread 对照）：18px 上限
  // 让作者/机构短块过大、版面空旷；13px 上限+9px 下限在 120% 时即 Scholaread
  // 式满版可读效果，且各段仍保持与原块的视觉大小对应
  const segFont = (a: Anchor) => {
    const h = (a.bb[3] - a.bb[1]) * scale!;
    const w = Math.max(60, (a.bb[2] - a.bb[0]) * scale!);
    const len = Math.max(12, (a.block.original ?? "").trim().length);
    const est = Math.sqrt((h * w) / (0.55 * 1.25 * len));
    return Math.min(13, Math.max(9, est));
  };
  // 占位高度：镜像左栏版面，但尾部卡片超出页底时随之撑高（不截断译文）
  const contentH = layout ? Math.max(layout.h, cursorY) : undefined;

  return (
    <div
      className="relative mb-6"
      style={{ minHeight: contentH ? contentH + 28 : 920 }}
    >
      <div
        className="relative mx-auto"
        style={{
          width: layout ? pageW : undefined,
          height: contentH,
        }}
      >
        {!rotated && scale != null && (
          <div className="absolute inset-x-0 top-0">
            {placed.map(({ a, top, i }) => {
              const key = `${a.block.page}:${a.block.block_id}`;
              // 未翻译的普通块：瘦身占位条（高度≈原块渲染高，clamp 6-16px），
              // 不级联挤压下方已译段的位置对应；hover 仍可手动「译」
              const slim = !a.block.translated && !a.block.formula_hint;
              const slimH = Math.max(
                6,
                Math.min(16, (a.bb[3] - a.bb[1]) * scale)
              );
              // 层级启发：原文短块（标题/作者/节标题）居中加重，正文两端对齐
              const headingish =
                (a.block.original?.trim().length ?? 0) < 50;
              return slim ? (
                <div
                  key={key}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                    cardRefs.current.set(key, el);
                  }}
                  className="group absolute inset-x-0"
                  style={{ top }}
                  title="未翻译——悬停显示「译」按钮，或点击左栏灰块"
                >
                  <div
                    className="rounded border border-dashed border-slate-200 dark:border-slate-700"
                    style={{ height: slimH }}
                  />
                  <div className="absolute -top-3 right-2 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <BlockTranslateButton block={a.block} />
                  </div>
                </div>
              ) : (
              <div
                key={key}
                ref={(el) => {
                  itemRefs.current[i] = el;
                  cardRefs.current.set(key, el);
                }}
                onMouseEnter={() => setHoveredId(key)}
                onMouseLeave={() => setHoveredId(null)}
                className={`group relative rounded-[4px] transition-colors duration-150 ${
                  hoveredId === key ? "bg-blue-500/10" : ""
                }`}
                style={{
                  position: "absolute",
                  top,
                  left: 0,
                  right: 0,
                  /* prose 根字号 = 1rem × var(--reader-zoom)，按段注入估算字号 */
                  ...({ "--reader-zoom": a.block.formula_hint ? 0.75 : segFont(a) / 16 } as React.CSSProperties),
                }}
              >
                {/* 操作按钮悬浮显示（hover 才出现），不占版面高度 */}
                <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {a.block.formula_hint ? (
                    <FormulaButton block={a.block} />
                  ) : (
                    <BlockTranslateButton block={a.block} />
                  )}
                </div>
                <div
                  className={`px-1 py-0.5 text-slate-800 dark:text-slate-200 ${
                    headingish
                      ? "text-center font-medium leading-snug"
                      : "leading-[1.7] [text-align:justify]"
                  }`}
                >
                  <MarkdownText text={a.block.translated ?? ""} />
                </div>
              </div>
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

/** 译文卡（锚定卡与未对齐尾部共用形态） */
function TranslateCard({
  block,
  zoom,
  cardRefs,
}: {
  block: TextBlock;
  zoom: number;
  cardRefs: { current: Map<string, HTMLElement | null> };
}) {
  return (
    <div
      ref={(el) => {
        cardRefs.current.set(`${block.page}:${block.block_id}`, el);
      }}
      className="rounded-lg border border-slate-200 bg-white/95 shadow-sm dark:border-slate-700 dark:bg-slate-900/95"
      style={{ fontSize: `${0.75 * zoom}rem` }}
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
