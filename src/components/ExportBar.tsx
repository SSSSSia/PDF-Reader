import { useState } from "react";
import { usePdfStore } from "../stores/pdfStore";
import { useConfigStore } from "../stores/configStore";
import { exportBilingual, ExportFormat } from "../utils/export";

export default function ExportBar() {
  const { pages } = usePdfStore();
  const { config } = useConfigStore();
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    if (!pages.length) return;
    setBusy(true);
    try {
      await exportBilingual(pages, format, {
        source: config?.translate.source_language,
        target: config?.translate.target_language,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value as ExportFormat)}
        aria-label="导出格式"
        className="input-field w-auto"
      >
        <option value="markdown">Markdown</option>
        <option value="text">纯文本</option>
      </select>
      <button onClick={handle} disabled={busy || !pages.length} className="btn-secondary">
        {busy ? "导出中…" : "导出"}
      </button>
    </div>
  );
}
