import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { PageResult } from "../types";

export type ExportFormat = "markdown" | "text";

interface ExportMeta {
  source?: string;
  target?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 双语 Markdown：每页一个二级标题，原文/译文成对呈现，便于二次编辑与分享。
export function buildMarkdown(pages: PageResult[], meta?: ExportMeta): string {
  const lines: string[] = ["# PDF 双语对照导出", ""];
  if (meta?.source || meta?.target) {
    lines.push(`> 翻译方向: ${meta.source ?? "?"} → ${meta.target ?? "?"}`);
  }
  lines.push(`> 共 ${pages.length} 页`, "");

  pages.forEach((page) => {
    lines.push(`## 第 ${page.page + 1} 页`, "");
    page.blocks.forEach((b) => {
      lines.push("**原文**", b.original || "", "", "**译文**", b.translated || "", "");
    });
  });
  return lines.join("\n");
}

// 双语纯文本：分隔线 +【原文】/【译文】标签，适合不支持 Markdown 的场景。
export function buildText(pages: PageResult[], meta?: ExportMeta): string {
  const out: string[] = ["PDF 双语对照导出"];
  if (meta?.source || meta?.target) {
    out.push(`翻译方向: ${meta.source ?? "?"} → ${meta.target ?? "?"}`);
  }
  out.push(`共 ${pages.length} 页`, "");

  pages.forEach((page) => {
    out.push(`========== 第 ${page.page + 1} 页 ==========`, "");
    out.push("【原文】");
    page.blocks.forEach((b) => out.push(b.original || ""));
    out.push("", "【译文】");
    page.blocks.forEach((b) => out.push(b.translated || ""));
    out.push("");
  });
  return out.join("\n");
}

/**
 * 导出双语结果。
 * - Tauri 环境：用 save 对话框选路径，再经 Rust `export_content` 写文件（正确落盘）。
 * - 浏览器回退：直接触发 blob 下载（dev 无 Rust 后端时仍可用）。
 * @returns 是否成功导出
 */
export async function exportBilingual(
  pages: PageResult[],
  format: ExportFormat,
  meta?: ExportMeta,
): Promise<boolean> {
  const content = format === "markdown" ? buildMarkdown(pages, meta) : buildText(pages, meta);
  const ext = format === "markdown" ? "md" : "txt";
  const defaultName = `bilingual-${today()}.${ext}`;

  if ("__TAURI_INTERNALS__" in window) {
    try {
      const selected = await save({
        defaultPath: defaultName,
        filters: [
          {
            name: format === "markdown" ? "Markdown" : "Text",
            extensions: [ext],
          },
        ],
      });
      if (!selected) return false;
      await invoke("export_content", { path: selected, content });
      return true;
    } catch (e) {
      console.error("Tauri 导出失败，回退到下载:", e);
    }
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
