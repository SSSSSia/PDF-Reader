import { useEffect, useMemo, useRef, useState } from "react";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore, effectiveZoom } from "../stores/uiStore";
import { useZoomWheel } from "../hooks/useZoomWheel";
import { usePdfDocument } from "../hooks/usePdfDocument";
import { useLazyPage } from "../hooks/useLazyPage";
import MarkdownText from "./common/MarkdownText";
import BlockTranslateButton from "./common/BlockTranslateButton";
import FormulaButton from "./common/FormulaButton";
import type { TextBlock } from "../types";

type BBox = [number, number, number, number];
/** 替换块：整卡锚定首段 bbox，其余段仅做白底遮盖（译文是块级整体，不拆段） */
type ReplaceBlock = { block: TextBlock; first: BBox };

/** 纯图片块（markdown 图片引用，译文=原文）：原图已在 PDF 里，替换层会重复，跳过 */
const isPureImage = (t: string) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(t);

/**
 * 原版PDF·原文替换（阶段7-T6，源起用户 2026-09-09 需求澄清
 * "译文也是 PDF 排版，段落原地替换"）：pdfjs 原样渲染（版式 100% 不动），
 * 已译块在首段 bbox 上盖白底译文层（left/top/width = bbox × scale），
 * 视觉上原文被译文原地替换；跨页/断栏块的续段只做白底遮盖（译文是
 * 块级整体不拆段，防原文从续段透出）。
 *
 * 交互：悬停译文层显示 OCR 原文（纯 CSS group-hover 双层切换），
 * 悬停角标出块级「译/重译/式」按钮。未译块不渲染（保留原文，
 * 后台翻译推送后自动替换出现）；纯图片块跳过；旋转页不渲染
 * （bbox 坐标会错位，与点击翻译形态口径一致）。
 *
 * 字号 0.8×zoom（中文可略小于原英文且降低溢出概率）；高度 min-height
 * = bbox 高、内容可自然向下延伸（"排版尽量不变"允许段落区微调，
 * 截断丢信息更不可取）。缩放同原版组语义（缺省 70%，阶段7-T2）。
 */
export default function OriginalReplacePage() {
  const filePath = usePdfStore((s) => s.filePath);
  const pages = usePdfStore((s) => s.pages);
  const zoom = effectiveZoom(
    useUiStore((s) => s.zoom),
    useUiStore((s) => s.readerMode)
  );
  const zoomRef = useZoomWheel<HTMLDivElement>();
  const { pdf, error } = usePdfDocument(filePath);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapW, setWrapW] = useState(0);

  // 视口宽度跟踪（fit-width 基准；显式宽度方案撑横向滚动，阶段7-T1 修复）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWrapW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 替换索引：按块锚定首段页坐标；续段 bbox 挂各自所在页做遮盖；
  // 未译/纯图片块不进索引（保留原文/原图）
  const { replaceByPage, coverByPage } = useMemo(() => {
    const r = new Map<number, ReplaceBlock[]>();
    const c = new Map<number, BBox[]>();
    pages.forEach((p) =>
      p.blocks.forEach((b) => {
        if (!b.translated || isPureImage(b.translated)) return;
        const segs = b.bboxes?.length
          ? b.bboxes
          : b.bbox
            ? [{ page: p.page, bbox: b.bbox as BBox }]
            : [];
        if (!segs.length || !segs[0]?.bbox) return;
        const first = segs[0];
        const arr = r.get(first.page) ?? [];
        arr.push({ block: b, first: first.bbox });
        r.set(first.page, arr);
        segs.slice(1).forEach((s) => {
          if (!s?.bbox) return;
          const carr = c.get(s.page) ?? [];
          carr.push(s.bbox);
          c.set(s.page, carr);
        });
      })
    );
    return { replaceByPage: r, coverByPage: c };
  }, [pages]);

  return (
    <div ref={zoomRef}>
      <div
        ref={wrapRef}
        className="relative h-[calc(100vh-170px)] overflow-auto bg-slate-200 dark:bg-slate-950"
      >
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
          <div
            className="mx-auto px-4 pb-16 pt-3"
            style={{ width: wrapW > 0 ? (wrapW - 48) * zoom + 32 : undefined }}
          >
            {pages.map((p) => (
              <ReplacePage
                key={p.page}
                pdf={pdf}
                pageNo={p.page + 1}
                blocks={replaceByPage.get(p.page) ?? []}
                covers={coverByPage.get(p.page) ?? []}
                wrapW={wrapW}
                zoom={zoom}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单页：懒渲染 canvas + 续段白底遮盖 + 替换译文层（悬停看原文） */
function ReplacePage({
  pdf,
  pageNo,
  blocks,
  covers,
  wrapW,
  zoom,
}: {
  pdf: any;
  pageNo: number;
  blocks: ReplaceBlock[];
  covers: BBox[];
  wrapW: number;
  zoom: number;
}) {
  const { holderRef, canvasRef, layout, rotated } = useLazyPage({
    pdf,
    pageNo,
    renderW: wrapW,
    zoom,
  });

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
            {covers.map((bb, i) => (
              <div
                key={`cover-${i}`}
                className="absolute bg-white"
                style={{
                  left: bb[0] * layout.scale,
                  top: bb[1] * layout.scale,
                  width: Math.max(2, (bb[2] - bb[0]) * layout.scale),
                  height: Math.max(2, (bb[3] - bb[1]) * layout.scale),
                }}
              />
            ))}
            {[...blocks]
              .sort((a, b) => a.first[1] - b.first[1])
              .map((r) => (
                <ReplaceLayer
                  key={r.block.block_id}
                  block={r.block}
                  bb={r.first}
                  scale={layout.scale}
                  zoom={zoom}
                />
              ))}
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

/** 替换译文层：白底盖原文，悬停切 OCR 原文 + 出块级操作按钮 */
function ReplaceLayer({
  block,
  bb,
  scale,
  zoom,
}: {
  block: TextBlock;
  bb: BBox;
  scale: number;
  zoom: number;
}) {
  return (
    <div
      className="group absolute rounded-[3px] border border-transparent bg-white transition-colors duration-100 hover:border-blue-300"
      style={{
        left: bb[0] * scale,
        top: bb[1] * scale,
        width: Math.max(2, (bb[2] - bb[0]) * scale),
        minHeight: Math.max(2, (bb[3] - bb[1]) * scale),
        fontSize: `${0.8 * zoom}rem`,
      }}
    >
      <div className="px-1 py-0.5 leading-relaxed text-slate-900 group-hover:hidden">
        <MarkdownText text={block.translated} />
      </div>
      <div className="hidden px-1 py-0.5 leading-relaxed text-slate-500 group-hover:block">
        <MarkdownText text={block.original} />
      </div>
      <div className="absolute right-0.5 top-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {/* 公式块只出「式」（识别成功自动重译），其余「译/重译」 */}
        {block.formula_hint ? (
          <FormulaButton block={block} />
        ) : (
          <BlockTranslateButton block={block} />
        )}
      </div>
    </div>
  );
}
