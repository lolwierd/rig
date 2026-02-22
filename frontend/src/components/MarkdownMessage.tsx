import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  text: string;
  className?: string;
}

export function MarkdownMessage({ text, className }: MarkdownMessageProps) {
  if (!text) return null;

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-[14px] font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-[13px] font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-[13px] font-semibold">{children}</h3>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="marker:text-amber/70">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-amber/25 pl-3 text-text-dim">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-blue hover:text-blue/80 underline underline-offset-2"
            >
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="my-2 max-h-72 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text-dim">
              {children}
            </pre>
          ),
          code: ({ className: codeClassName, children, ...props }: any) => {
            const isBlock = /language-/.test(codeClassName || "");
            if (isBlock) {
              return (
                <code className="font-mono text-[11px] text-text-dim" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-amber" {...props}>
                {children}
              </code>
            );
          },
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
