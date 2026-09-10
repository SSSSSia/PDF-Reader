/**
 * 「双语 PDF」工具栏按钮（阶段9-T2）。
 *
 * 一颗按钮承载全生命周期（与工具栏既有交互密度一致，不弹窗不跳页）：
 * - idle：点按 → 启动 BabelDOC 导出（命中后端缓存瞬时完成）
 * - running：显示进度百分比 + 阶段（title 提示），再点按 → 取消
 * - done：变为「打开双语PDF」，点按 → 系统默认程序打开 dual PDF
 * - error：红色提示，title 携带原因，再点按 → 重试
 * 状态存 babeldocStore（跨模式切换/路由不丢轮询）。
 */
import { usePdfStore } from "../stores/pdfStore";
import { useBabelDocStore } from "../stores/babeldocStore";
import { openLocalPdf, cancelBabeldoc } from "../lib/bridge";

export default function BabelDocButton() {
  const filePath = usePdfStore((s) => s.filePath);
  const { phase, progress, stage, dualPath, error, jobId, filePath: jobFile, start, clearError } =
    useBabelDocStore();

  const disabled = !filePath;
  const isRunning = phase === "running";

  const handleClick = async () => {
    if (disabled) return;
    if (phase === "done" && dualPath) {
      await openLocalPdf(dualPath);
      return;
    }
    if (isRunning && jobId) {
      await cancelBabeldoc(jobId);
      return;
    }
    if (phase === "error" && jobFile === filePath) {
      clearError(); // 落回 idle，下面 start 幂等判断不会误拦
    }
    await start(filePath);
  };

  let label = "双语PDF";
  let title = "用 BabelDOC 生成整篇双语对照 PDF（同页并排，系统阅读器打开）";
  let tone =
    "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700";

  if (isRunning) {
    label = `双语PDF ${Math.round(progress)}%`;
    title = `${stage || "翻译中"}　·　点按取消`;
  } else if (phase === "done") {
    label = "打开双语PDF";
    title = dualPath;
  } else if (phase === "error") {
    title = `${error}　·　点按重试`;
    tone =
      "!text-red-600 dark:!text-red-400 !border-red-300 dark:!border-red-700 hover:!bg-red-50 dark:hover:!bg-red-950/40";
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={disabled ? "需先翻译一篇 PDF（需源文件在原路径）" : title}
      className={`btn-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      {label}
    </button>
  );
}
