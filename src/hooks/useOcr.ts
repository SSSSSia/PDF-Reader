import { useCallback } from "react";
import { usePdfStore } from "../stores/pdfStore";
import { runPipeline, getPipelineStatus } from "../lib/bridge";
import { PageResult, PipelineResult } from "../types";

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 分钟上限，避免无限轮询

/** pages 渐进签名：已译 block 数。签名不变则跳过 setState，避免每秒无变化重渲染（阶段1-T1 去抖）。 */
function progressiveSignature(pages: PageResult[]): number {
  let translated = 0;
  let total = 0;
  for (const p of pages) {
    for (const b of p.blocks) {
      total += 1;
      if (b.translated) translated += 1;
    }
  }
  return pages.length * 1_000_000 + total * 1_000 + translated;
}

export function useOcr() {
  const { setLoading, setProgress, setPages, setError, setResult } =
    usePdfStore();

  /**
   * 启动流水线并轮询至完成（阶段1-T1 渐进呈现）。
   *
   * 关键行为：
   * - 轮询过程中只要 pages 非空就持续 setPages——OCR 完成（progress≈30）即回传全文原文，
   *   译文随翻译进度逐段流入，前端不再等到 done 才渲染（旧实现是"感知慢"的最大根因）。
   * - 去抖：progressiveSignature 变化才 setState，长文档下每秒轮询不会引发无谓重渲染。
   * - 后端 job 被淘汰/重启后返回 unknown，显式报错而非空转到超时。
   *
   * @returns 成功返回 true，失败返回 false
   */
  const processFile = useCallback(
    async (filePath: string): Promise<boolean> => {
      try {
        setLoading(true);
        setProgress(0);
        setError(null);

        const startStr = (await runPipeline(filePath)) as string;
        const start = JSON.parse(startStr) as PipelineResult;

        if (start.status === "failed") {
          setError(start.error ?? "流水线启动失败");
          return false;
        }
        if (!start.job_id) {
          setError("后端未返回 job_id，无法跟踪处理进度");
          return false;
        }

        const deadline = Date.now() + MAX_WAIT_MS;
        let lastSig = -1;
        while (Date.now() < deadline) {
          const statusStr = (await getPipelineStatus(
            start.job_id,
          )) as string;
          const status = JSON.parse(statusStr) as PipelineResult;

          // 钳制兜底：后端进度理论上 ≤100，异常时不得撑破进度条
          setProgress(Math.min(100, status.progress ?? 0));

          if (status.status === "unknown") {
            setError("任务已过期或后端已重启，请重新处理该文件");
            return false;
          }

          // 渐进回传：pages 就绪（OCR 完成后）即渲染原文，译文随后逐段流入
          const pages = status.pages ?? [];
          if (pages.length > 0) {
            const sig = progressiveSignature(pages);
            if (sig !== lastSig) {
              setPages(pages);
              lastSig = sig;
            }
          }

          if (status.status === "done") {
            setPages(pages);
            setResult(status);
            return true;
          }
          if (status.status === "failed") {
            setError(status.error ?? "处理失败，请重试");
            return false;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        setError("处理超时，请稍后重试");
        return false;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setProgress, setPages, setError, setResult]
  );

  return { processFile };
}
