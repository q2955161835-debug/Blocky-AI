import { describe, expect, it } from "vitest";
import { parseDocument, chunkDocument } from "../src/documents";
import { formatLocator } from "../src/retrieval";
const document = (text: string, format = "markdown") => ({
  documentId: "doc-water",
  title: "水循环",
  format,
  text,
  revision: "v1",
  locator: { path: "lesson.md", lineStart: 1, lineEnd: 20 },
  metadata: {},
});
describe("real document parsing", () => {
  it("preserves native extracted page and cell locations through chunking and citations", async () => {
    const source = {
      ...document("Plant leaves absorb light.\nRoots absorb water.", "pdf"),
      locator: { path: "plants.pdf", lineStart: 1, lineEnd: 2, page: 3 },
      metadata: { parser: "blocky.document-result/v1" },
    };
    const chunks = await chunkDocument("source-a", parseDocument(source), {
      size: 35,
      overlap: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.locator.page === 3)).toBe(true);
    expect(formatLocator(chunks[0].locator)).toContain("第 3 页");
    expect(
      formatLocator({
        path: "table.xlsx",
        lineStart: 1,
        lineEnd: 1,
        sheet: "植物",
        cellRange: "B2:C2",
        row: 2,
      }),
    ).toContain("植物 · B2:C2 · 第 2 行");
  });
  it("keeps original line positions while removing HTML executable and navigation content", () => {
    const parsed = parseDocument(
      document(
        "<h1>Water</h1>\n<script>private()</script>\n<p>Evaporation &amp; rain.</p>\n<nav>menu</nav>",
        "html",
      ),
    );
    expect(parsed.lines.map((l) => l.text).join(" ")).toBe(
      "Water Evaporation & rain.",
    );
    expect(parsed.lines.at(-1)?.line).toBe(3);
  });
  it("keeps stable content IDs after insertion and exact source lines", async () => {
    const first = await chunkDocument(
      "source-a",
      parseDocument(document("# Water\n\nEvaporation.\n\nRain.")),
      { size: 30, overlap: 0 },
    );
    const second = await chunkDocument(
      "source-a",
      parseDocument(document("Intro.\n\n# Water\n\nEvaporation.\n\nRain.")),
      { size: 30, overlap: 0 },
    );
    const old = first.find((c) => c.text === "Evaporation.")!;
    const updated = second.find((c) => c.text === "Evaporation.")!;
    expect(old).toBeDefined();
    expect(updated.chunkId).toBe(old.chunkId);
    expect(old.locator.lineStart).toBe(3);
    expect(updated.locator.lineStart).toBe(5);
  });
  it("rejects unsupported or binary content and invalid chunk budgets", async () => {
    expect(() => parseDocument(document("binary", "pdf"))).toThrow(
      "BLK-KNOWLEDGE-FORMAT",
    );
    expect(() => parseDocument(document("a\0b"))).toThrow(
      "BLK-KNOWLEDGE-FORMAT",
    );
    await expect(
      chunkDocument("source-a", parseDocument(document("x")), {
        size: 10,
        overlap: 10,
      }),
    ).rejects.toThrow("BLK-KNOWLEDGE-BUDGET");
  });
});
