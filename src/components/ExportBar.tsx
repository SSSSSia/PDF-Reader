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
    <div className="flex items-center gap-2">
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value as ExportFormat)}
        className="border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
      >
        <option value="markdown">Markdown</option>
        <option value="text">纯文本</option>
      </select>
      <button
        onClick={handle}
        disabled={busy || !pages.length}
        className="px-3 py-1 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "导出中…" : "导出"}
      </button>
    </div>
  );
}
