import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Vite 把 worker 作为本地资源打包（与 usePdfThumbnails 同一约定；重复赋值 workerSrc 幂等）
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { usePdfStore } from "../stores/pdfStore";
import { convertFileSrc } from "../lib/bridge";
import MarkdownText from "./common/MarkdownText";
import BlockTranslateButton from "./common/BlockTranslateButton";
import type { PageResult, TextBlock } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type BBox = [number, number, number, number];
type BBoxSeg = { page: number; bbox: BBox };
type Overlay = { block: TextBlock; bb: BBox };
type PageLayout = { scale: number; w: number; h: number };

/**
 * 原版对照模式（阶段5-T3，D6 立项）：pdfjs 原样渲染 PDF 页面（公式/图表/
 * 双栏版式零损失），已译块按多段 bbox 高亮（断栏/跨页续段各自所在页都
 * 有高亮），点击浮层查看译文。
 *
 * 设计要点（Spike 实测依据见 docs/阶段4-原生渲染路线评估.md §4.1）：
 * - 连续滚动逐页懒渲染：IntersectionObserver(rootMargin 600px) 触发，
 *   渲染任务可取消（task.cancel）防止快速滚动时的渲染竞态；
 * - fit-width × devicePixelRatio × zoom：canvas 物理像素按 dpr 放大保证
 *   高清，CSS 尺寸按逻辑 scale 定位——overlay 坐标 = bbox(pt) × scale；
 * - bbox 为 PyMuPDF top-left 原点坐标，与 pdfjs 旋转 0° viewport 直接
 *   乘法兼容；旋转页不渲染 overlay（坐标会错位，明确提示）；
 * - bbox 缺失（公式碎块/图内文字/扫描页）只是不高亮，页面渲染零依赖匹配。
 */
export default function OriginalReader() {
  const filePath = usePdfStore((s) => s.filePath);
  const pages = usePdfStore((s) => s.pages);
  const [pdf, setPdf] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapW, setWrapW] = useState(0);

  // 加载 PDF 文档（桥接层双模：Tauri convertFileSrc / 浏览器 /api/file/raw）
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    let doc: any = null;
    (async () => {
      try {
        setError(null);
        // pdfjs 6 破坏性变更：getDocument 只收 DocumentInitParameters 对象，
        // 裸字符串简写已删除（传 string 时 src.url 为 undefined 直接抛
        // "expected either data, range, or url parameter"，实测踩坑）
        doc = await pdfjsLib
          .getDocument({ url: convertFileSrc(filePath) } as any)
          .promise;
        if (cancelled) {
          doc.destroy?.();
          return;
        }
        setPdf(doc);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy?.();
    };
  }, [filePath]);

  // 视口宽度跟踪（fit-width 基准）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWrapW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stepZoom = (d: number) =>
    setZoom((z) => Math.min(3, Math.max(0.5, Math.round((z + d) * 100) / 100)));

  // 每页 overlay 分段索引：一个逻辑块可有多段坐标（断栏/跨页合并），
  // 跨页合并块的分段按 seg.page 挂到各自所在页（含续文页）
  const overlaysByPage = useMemo(() => {
    const m = new Map<number, Overlay[]>();
    pages.forEach((p) =>
      p.blocks.forEach((b) => {
        const segs: BBoxSeg[] =
          b.bboxes && b.bboxes.length
            ? b.bboxes
            : b.bbox
              ? [{ page: p.page, bbox: b.bbox as BBox }]
              : [];
        segs.forEach((seg) => {
          if (!seg?.bbox) return;
          const arr = m.get(seg.page) ?? [];
          arr.push({ block: b, bb: seg.bbox });
          m.set(seg.page, arr);
        });
      })
    );
    return m;
  }, [pages]);

  return (
    <div
      ref={wrapRef}
      className="relative h-[calc(100vh-170px)] overflow-y-auto bg-slate-200 dark:bg-slate-950"
    >
      {/* 缩放控制（吸顶悬浮） */}
      <div className="sticky top-2 z-20 mx-auto flex w-max items-center gap-2 rounded-lg border border-slate-300 bg-white/95 px-2 py-1 text-xs shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
        <button
          onClick={() => stepZoom(-0.15)}
          className="h-6 w-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          aria-label="缩小"
        >
          −
        </button>
        <span className="w-10 text-center tabular-nums text-slate-600 dark:text-slate-300">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => stepZoom(0.15)}
          className="h-6 w-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          aria-label="放大"
        >
          +
        </button>
        <span className="hidden text-slate-400 sm:inline dark:text-slate-500">
          点高亮块看译文
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-auto mt-6 max-w-2xl rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300"
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
        <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-3">
          {pages.map((p) => (
            <OriginalPage
              key={p.page}
              pdf={pdf}
              pageNo={p.page + 1}
              overlays={overlaysByPage.get(p.page) ?? []}
              wrapW={wrapW}
              zoom={zoom}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单页：懒渲染 canvas + bbox overlay（多段）+ 译文浮层 */
function OriginalPage({
  pdf,
  pageNo,
  overlays,
  wrapW,
  zoom,
}: {
  pdf: any;
  pageNo: number;
  overlays: Overlay[];
  wrapW: number;
  zoom: number;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [near, setNear] = useState(false);
  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [rotated, setRotated] = useState(false);
  const [selected, setSelected] = useState<{ block: TextBlock; bb: BBox } | null>(
    null
  );

  // 接近视口才启动渲染（懒加载，长文档滚动不卡）
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 渲染当前页（任务可取消：快速滚动/改缩放时不做无用功）
  useEffect(() => {
    if (!near || !pdf || !canvasRef.current || wrapW <= 0) return;
    let cancelled = false;
    let task: any = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNo);
        if (cancelled) return;
        if (((page.rotate as number) ?? 0) % 360 !== 0) setRotated(true);
        const base = page.getViewport({ scale: 1 });
        const scale = ((wrapW - 48) / base.width) * zoom;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${Math.floor(scale * base.width)}px`;
        canvas.style.height = `${Math.floor(scale * base.height)}px`;
        task = page.render({ canvas, viewport });
        await task.promise;
        if (!cancelled)
          setLayout({ scale, w: scale * base.width, h: scale * base.height });
      } catch (e: any) {
        if (!cancelled && e?.name !== "RenderingCancelledException")
          console.error(`原版渲染 p${pageNo} 失败:`, e);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [near, pdf, pageNo, wrapW, zoom]);

  return (
    <div
      ref={holderRef}
      className="relative mb-6"
      style={{ minHeight: layout ? layout.h + 28 : 920 }}
      onMouseDown={() => setSelected(null)}
    >
      <div
        className="relative mx-auto bg-white shadow-md dark:shadow-black/50"
        style={{ width: layout ? layout.w : undefined }}
      >
        <canvas ref={canvasRef} className="block" />

        {layout && !rotated && (
          <div className="absolute inset-0">
            {overlays.map((o, i) => {
              const bb = o.bb;
              const s = layout.scale;
              const has = !!o.block.translated;
              return (
                <div
                  key={`${o.block.block_id}-${i}`}
                  role="button"
                  tabIndex={0}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setSelected({ block: o.block, bb })}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setSelected({ block: o.block, bb })
                  }
                  className={`absolute rounded-[3px] transition-colors duration-100 ${
                    has
                      ? "cursor-pointer bg-blue-500/10 hover:bg-blue-500/30"
                      : "cursor-pointer bg-slate-400/5 hover:bg-slate-400/30"
                  }`}
                  style={{
                    left: bb[0] * s,
                    top: bb[1] * s,
                    width: Math.max(2, (bb[2] - bb[0]) * s),
                    height: Math.max(2, (bb[3] - bb[1]) * s),
                  }}
                  title={has ? "点击查看译文" : "未翻译"}
                />
              );
            })}

            {selected && (
              <BlockCard
                block={selected.block}
                bb={selected.bb}
                layout={layout}
                onClose={() => setSelected(null)}
              />
            )}
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

/** 译文浮层：只显示译文（用户反馈 2026-09-07），优先贴块下方，空间不足翻到上方 */
function BlockCard({
  block,
  bb,
  layout,
  onClose,
}: {
  block: TextBlock;
  bb: BBox;
  layout: PageLayout;
  onClose: () => void;
}) {
  const s = layout.scale;
  const cardW = Math.min(380, Math.max(260, layout.w * 0.45));
  const left = Math.min(Math.max(4, bb[0] * s), Math.max(4, layout.w - cardW - 4));
  const below = bb[3] * s + 6;
  const top = below + 300 > layout.h ? Math.max(4, bb[1] * s - 306) : below;

  return (
    <div
      className="absolute z-30 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95"
      style={{ left, top, width: cardW }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          译文
        </span>
        <div className="flex items-center gap-1.5">
          <BlockTranslateButton block={block} />
          <button
            onClick={onClose}
            aria-label="关闭"
            className="h-6 w-6 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            ×
          </button>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto text-sm leading-relaxed text-slate-900 dark:text-slate-100">
        {block.translated ? (
          <MarkdownText text={block.translated} />
        ) : (
          <span className="italic text-slate-400 dark:text-slate-500">待翻译…</span>
        )}
      </div>
    </div>
  );
}
