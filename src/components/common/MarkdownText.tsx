import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { assetUrl } from "../../lib/bridge";

/**
 * Markdown 渲染组件：OCR/文本层返回的是 markdown（含表格/标题/公式/图片引用），
 * 旧实现当纯文本渲染导致排版错乱（实测问题），统一走 typography 排版。
 * 图片引用是本地绝对路径（文本层提取导出的论文插图），经 assetUrl 转为可访问 URL。
 */
export default function MarkdownText({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert sm:prose-base prose-headings:my-2 prose-p:my-1.5 prose-table:my-2 prose-li:my-0.5 prose-pre:my-2 prose-img:my-2 prose-img:rounded-lg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        {text || ""}
      </ReactMarkdown>
    </div>
  );
}
