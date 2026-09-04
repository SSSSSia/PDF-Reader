import { useCallback } from "react";
import { usePdfStore } from "../stores/pdfStore";
import { runPipeline, getPipelineStatus } from "../lib/bridge";
import { PipelineResult } from "../types";

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 分钟上限，避免无限轮询

export function useOcr() {
  const { setLoading, setProgress, setPages, setError, setResult } =
    usePdfStore();

  /**
   * 启动流水线并轮询至完成。
   *
   * 重要：后端 /api/pipeline/run 是**异步**的——立即返回 status=running 并转入
   * 后台任务处理，因此必须持续轮询 /api/pipeline/status 才能拿到结果。
   *（旧实现只读首次返回的 running，导致结果永不回显，即缺陷 R1。）
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
        while (Date.now() < deadline) {
          const statusStr = (await getPipelineStatus(
            start.job_id,
          )) as string;
          const status = JSON.parse(statusStr) as PipelineResult;

          setProgress(status.progress ?? 0);

          if (status.status === "done") {
            setPages(status.pages ?? []);
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
