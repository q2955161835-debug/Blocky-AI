import { parse, type DefaultTreeAdapterMap } from "parse5";
import { digest } from "@blocky/language-schema";
import type { DocumentInput, ParsedDocument, Chunk } from "./types";
const formats = new Set([
  "text",
  "txt",
  "markdown",
  "md",
  "html",
  "htm",
  "code",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "css",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
]);
export function parseDocument(input: DocumentInput): ParsedDocument {
  if (
    !formats.has(input.format.toLowerCase()) ||
    input.text.includes("\0") ||
    new TextEncoder().encode(input.text).length > 2 * 1024 * 1024
  )
    throw Error("BLK-KNOWLEDGE-FORMAT");
  const { text, ...rest } = input;
  const lines: ParsedDocument["lines"] = [];
  if (["html", "htm"].includes(input.format.toLowerCase())) {
    const tree = parse(text, {
      sourceCodeLocationInfo: true,
      scriptingEnabled: false,
    });
    const skip = new Set([
      "script",
      "style",
      "nav",
      "footer",
      "noscript",
      "template",
      "iframe",
      "svg",
      "head",
    ]);
    const walk = (node: DefaultTreeAdapterMap["node"]) => {
      if (
        "tagName" in node &&
        (skip.has(node.tagName) ||
          node.attrs.some(
            (a) =>
              a.name === "hidden" ||
              (a.name === "aria-hidden" && a.value === "true"),
          ))
      )
        return;
      if (
        node.nodeName === "#text" &&
        "value" in node &&
        node.sourceCodeLocation
      ) {
        const value = node.value.replace(/\s+/g, " ").trim();
        if (value)
          lines.push({ text: value, line: node.sourceCodeLocation.startLine });
      }
      if ("childNodes" in node)
        for (const child of node.childNodes) walk(child);
    };
    walk(tree);
  } else {
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .forEach((line, i) => {
        lines.push({
          text: line.replace(/[\t ]+$/g, ""),
          line: input.locator.lineStart + i,
        });
      });
  }
  return { ...rest, lines };
}
/** UTF-8 byte budget for excerpts; actual Embedding windows use the model tokenizer. */
export const estimateTokens = (text: string) =>
  new TextEncoder().encode(text).length;
export async function chunkDocument(
  sourceId: string,
  input: ParsedDocument,
  options: { size: number; overlap: number },
): Promise<Chunk[]> {
  if (
    !Number.isInteger(options.size) ||
    options.size < 1 ||
    options.size > 16000 ||
    !Number.isInteger(options.overlap) ||
    options.overlap < 0 ||
    options.overlap >= options.size
  )
    throw Error("BLK-KNOWLEDGE-BUDGET");
  const groups: (typeof input.lines)[] = [];
  let group: typeof input.lines = [];
  for (const line of input.lines) {
    if (!line.text.trim()) {
      if (group.length) groups.push(group);
      group = [];
    } else group.push(line);
  }
  if (group.length) groups.push(group);
  const chunks: Chunk[] = [],
    occurrences = new Map<string, number>();
  for (const group of groups) {
    const points: { char: string; line: number }[] = [];
    group.forEach((l, i) => {
      if (i) points.push({ char: "\n", line: l.line });
      for (const char of l.text) points.push({ char, line: l.line });
    });
    for (
      let offset = 0;
      offset < points.length;
      offset += options.size - options.overlap
    ) {
      const slice = points.slice(offset, offset + options.size);
      const text = slice
        .map((p) => p.char)
        .join("")
        .trim();
      if (!text) continue;
      const contentDigest = await digest(text);
      const occurrence = occurrences.get(contentDigest) ?? 0;
      occurrences.set(contentDigest, occurrence + 1);
      chunks.push({
        chunkId: `chunk-${await digest([sourceId, input.documentId, contentDigest, occurrence])}`,
        sourceId,
        documentId: input.documentId,
        title: input.title,
        text,
        digest: contentDigest,
        revision: input.revision,
        locator: {
          ...input.locator,
          lineStart: slice[0].line,
          lineEnd: slice.at(-1)!.line,
        },
        metadata: input.metadata,
        tokens: estimateTokens(text),
      });
      if (offset + options.size >= points.length) break;
    }
  }
  return chunks;
}
