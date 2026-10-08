import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./ChatMarkdown.css";

const plugins = [remarkGfm];
const components: Components = {
  a: ({ href, children }) => href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ) : <>{children}</>,
  // Replies must not fetch remote content merely by being displayed.
  img: ({ alt }) => <span>{alt}</span>,
  pre: ({ children }) => <pre tabIndex={0} aria-label="代码块">{children}</pre>,
  table: ({ children }) => (
    <div className="chat-markdown-table" tabIndex={0} role="region" aria-label="表格">
      <table>{children}</table>
    </div>
  ),
};

function publicUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

// Completed messages retain their text while unrelated tool events update.
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={plugins} components={components} urlTransform={publicUrl}>
        {text}
      </Markdown>
    </div>
  );
});
