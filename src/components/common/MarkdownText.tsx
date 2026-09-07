import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { assetUrl, openExternal } from "../../lib/bridge";
import { preprocessMath } from "../../lib/mathFragment";

/**
 * Markdown 渲染组件：OCR/文本层返回的是 markdown（含表格/标题/公式/图片引用），
 * 旧实现当纯文本渲染导致排版错乱（实测问题），统一走 typography 排版。
 * 图片引用是本地绝对路径（文本层提取导出的论文插图），经 assetUrl 转为可访问 URL。
 *
 * urlTransform 必须覆写（2026-09-06 实测"图片显示不出来"根因）：
 * react-markdown v10 默认 defaultUrlTransform 只放行 http/https 等协议，
 * 本地盘符路径 `D:/...` 被当作未知协议 `d:` 整个剥成空串——img src 恒为空。
 * 内容全部来自用户本地 PDF 提取，信任来源，直接原样放行。
 */
export default function MarkdownText({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert sm:prose-base prose-headings:my-2 prose-p:my-1.5 prose-table:my-2 prose-li:my-0.5 prose-pre:my-2 prose-img:my-2 prose-img:rounded-lg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        urlTransform={(url) => url}
        components={{
          a: ({ href, children }) => {
            // 链接不在软件内打开（会顶掉整个阅读界面）：
            // Tauri 内经 shell.open 交给默认浏览器，浏览器内开新标签页
            const url = typeof href === "string" ? href : "";
            return (
              <a
                href={url}
                onClick={(e) => {
                  e.preventDefault();
                  if (url) openExternal(url).catch(() => {});
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const raw = typeof src === "string" ? src : "";
            return (
              <img
                src={assetUrl(raw)}
                alt={alt || ""}
                loading="lazy"
                className="mx-auto max-w-full rounded-lg"
              />
            );
          },
        }}
      >
        {preprocessMath(text || "")}
      </ReactMarkdown>
    </div>
  );
}
