import { expect, it } from "vitest";
import { chunkDocument, parseDocument } from "../src/documents";
import { KeywordIndex } from "../src/keyword";
import { selectEvidence, retrievalOptions } from "../src/retrieval";
import type { Chunk } from "../src/types";
async function chunks(): Promise<Chunk[]> {
  const texts = [
    [
      "a",
      "校车预约",
      "周末校车每周六上午九点出发，预约需要填写姓名和出行日期。",
    ],
    [
      "b",
      "Cache invalidation",
      "The cache is cleared when source permissions change. Updated documents replace older cache entries.",
    ],
    ["c", "会议记录", "明天讨论校车路线，会议记录保存到文档目录。"],
  ];
  return (
    await Promise.all(
      texts.map(async ([id, title, text]) =>
        chunkDocument(
          "source",
          parseDocument({
            documentId: id,
            title,
            text,
            format: "text",
            revision: "r1",
            locator: { path: `${id}.txt`, lineStart: 1, lineEnd: 1 },
            metadata: { subject: id === "b" ? "code" : "school" },
          }),
          { size: 768, overlap: 64 },
        ),
      ),
    )
  ).flat();
}
it("ranks Chinese and English source text deterministically and filters before scoring", async () => {
  const data = await chunks(),
    index = new KeywordIndex(data);
  expect(
    index.search(
      "校车预约需要填写什么",
      new Set(data.map((c) => c.chunkId)),
      10,
    )[0].chunkId,
  ).toBe(data[0].chunkId);
  expect(
    index.search(
      "source permission cache",
      new Set(data.map((c) => c.chunkId)),
      10,
    )[0].chunkId,
  ).toBe(data[1].chunkId);
  expect(index.search("cache", new Set([data[0].chunkId]), 10)).toEqual([]);
  expect(index.search("", new Set(data.map((c) => c.chunkId)), 10)).toEqual([]);
  expect(
    index.search("volcano", new Set(data.map((c) => c.chunkId)), 10),
  ).toEqual([]);
});
it("preserves BM25 frequencies across async batches and excludes denied records from IDF", async () => {
  const [base] = await chunks();
  const records = Array.from({ length: 260 }, (_, n) => ({
    ...base,
    chunkId: `chunk-${n}`,
    title: "",
    text: n === 129 ? "cache cache" : "cache",
  }));
  const index = await KeywordIndex.create(
    records,
    new AbortController().signal,
  );
  const hits = index.search("cache", new Set(["chunk-0", "chunk-129"]), 5);
  expect(hits.map((h) => h.chunkId)).toEqual(["chunk-129", "chunk-0"]);
  const raw = (Math.log(1.2) * 4.4) / 3.5;
  expect(hits[0].score).toBeCloseTo(raw / (1 + raw), 12);
  const denied = new AbortController();
  denied.abort();
  await expect(KeywordIndex.create(records, denied.signal)).rejects.toThrow();
});
it("keeps citations inside exact chunks and enforces context bytes and deduplication", async () => {
  const data = await chunks();
  const hits = data.map((chunk, i) => ({
    chunkId: chunk.chunkId,
    score: 1 - i / 10,
  }));
  const result = selectEvidence(
    "cache",
    data,
    hits,
    retrievalOptions({ contextBudget: 140, topK: 3, rerank: true }),
  );
  expect(result.citations.length).toBeGreaterThan(0);
  expect(result.contextBytes).toBeLessThanOrEqual(140);
  for (const citation of result.citations) {
    const original = data.find((c) => c.chunkId === citation.id)!;
    expect(original.text).toContain(citation.text);
    expect(citation.revision).toBe(original.revision);
    expect(citation.locator).toEqual(original.locator);
  }
});
it("rejects budgets and unsupported modes instead of silently changing strategy", () => {
  expect(() => retrievalOptions({ strategy: "magic" })).toThrow();
  expect(() => retrievalOptions({ topK: 0 })).toThrow();
  expect(() => retrievalOptions({ maxCandidates: 2, topK: 5 })).toThrow();
});
