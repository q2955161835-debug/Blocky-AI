import type { ReactNode } from "react";

interface MarkdownMessageProps {
  readonly text: string;
  readonly className: string;
}

function inlineContent(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/gu).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part,
  );
}

function isBlockStart(line: string): boolean {
  return /^#{2,3}\s+/u.test(line) || /^-\s+/u.test(line) || /^>\s?/u.test(line);
}

function renderMarkdownBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const heading = /^(#{2,3})\s+(.+)$/u.exec(line);
    if (heading) {
      const content = inlineContent(heading[2] ?? "");
      blocks.push(heading[1]?.length === 2
        ? <h2 key={`h-${index}`}>{content}</h2>
        : <h3 key={`h-${index}`}>{content}</h3>);
      index += 1;
      continue;
    }

    if (/^-\s+/u.test(line)) {
      const items: ReactNode[] = [];
      const listStart = index;
      while (index < lines.length && /^-\s+/u.test(lines[index] ?? "")) {
        items.push(
          <li key={`li-${index}`}>
            {inlineContent((lines[index] ?? "").replace(/^-\s+/u, ""))}
          </li>,
        );
        index += 1;
      }
      blocks.push(<ul key={`ul-${listStart}`}>{items}</ul>);
      continue;
    }

    if (/^>\s?/u.test(line)) {
      blocks.push(
        <blockquote key={`quote-${index}`}>
          {inlineContent(line.replace(/^>\s?/u, ""))}
        </blockquote>,
      );
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    const paragraphStart = index;
    while (index < lines.length && (lines[index] ?? "").trim() !== "" &&
      !isBlockStart(lines[index] ?? "")) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(
      <p key={`p-${paragraphStart}`}>{inlineContent(paragraph.join(" "))}</p>,
    );
  }

  return blocks;
}

export function MarkdownMessage({ text, className }: MarkdownMessageProps) {
  if (!/(?:^|\n)(?:#{2,3}|-|>)\s/u.test(text)) {
    return <p className={className}>{text}</p>;
  }
  return <div className={`${className} conversation-markdown`}>{renderMarkdownBlocks(text)}</div>;
}
