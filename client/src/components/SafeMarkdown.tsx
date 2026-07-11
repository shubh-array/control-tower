import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { toRehypeSanitizeSchema, isSafeUrl } from "../lib/sanitize.js";

interface SafeMarkdownProps {
  content: string;
  className?: string;
}

const schema = toRehypeSanitizeSchema();

export function SafeMarkdown({ content, className }: SafeMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a({ href, children, ...props }) {
            if (!href || !isSafeUrl(href)) {
              return <span>{children}</span>;
            }
            const isExternal =
              href.startsWith("https://") || href.startsWith("mailto:");
            return (
              <a
                href={href}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
        allowedElements={schema.tagNames}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
