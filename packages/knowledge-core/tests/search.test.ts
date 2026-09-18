import { expect, it } from "vitest";
import { KnowledgeSearch } from "../src/search";
import { chunkDocument, parseDocument } from "../src/documents";
import { digest } from "@blocky/language-schema";
async function fixture() {
  const doc = {
    documentId: "d",
    title: "Cache guide",
    text: "Cache entries expire when permissions change.",
    revision: "v1",
    format: "text",
    locator: { path: "guide.txt", lineStart: 1, lineEnd: 1 },
    metadata: {},
  };
  const chunks = await chunkDocument("s", parseDocument(doc), {
    size: 768,
    overlap: 64,
  });
  const state = {
    schemaVersion: "blocky.knowledge-store/v1",
    pending: null,
    index: {
      schemaVersion: "blocky.knowledge-index/v1",
      generation: 1,
      sources: { s: "v1" },
      chunking: { size: 768, overlap: 64 },
      documents: [
        {
          sourceId: "s",
          documentId: "d",
          revision: "v1",
          contentDigest: await digest(doc),
          chunkIds: chunks.map((c) => c.chunkId),
        },
      ],
      chunks,
    },
  };
  let revision = 1,
    generation = 1,
    loadCount = 0,
    heads = 0,
    denyAt = Infinity,
    vectorFailure = true;
  const call = async (op: string) => {
    if (op === "knowledge-sources") {
      if (++heads === denyAt) {
        generation++;
        revision++;
      }
      return {
        revision,
        generation,
        sources: [{ sourceId: "s", readable: generation === 1 }],
      };
    }
    if (op === "knowledge-load-index") {
      loadCount++;
      return { revision, generation, value: state };
    }
    if (op === "knowledge-vector-query") {
      if (vectorFailure) throw Error("BLK-EMBED-MISSING");
      return {
        modelId: "multilingual-e5-small-int8-v1",
        indexRevision: revision,
        generation,
        dimension: 384,
        hits: [{ chunkId: chunks[0].chunkId, score: 0.9 }],
        candidateCount: 1,
        elapsedMs: 1,
        modelSha256: "a".repeat(64),
      };
    }
    if (op === "knowledge-read-document") return doc;
    throw Error(op);
  };
  return {
    search: new KnowledgeSearch(call, "p", "c"),
    chunks,
    get loads() {
      return loadCount;
    },
    denyOnFinal() {
      denyAt = heads + 2;
    },
    allowVector() {
      vectorFailure = false;
    },
  };
}
it("caches only a matching published version and rejects revocation during query", async () => {
  const f = await fixture();
  const first = await f.search.query("cache permissions");
  expect(first.citations).toHaveLength(1);
  expect((await f.search.query("cache")).cacheHit).toBe(true);
  expect(f.loads).toBe(1);
  expect((await f.search.openCitation(first.citations[0])).text).toContain(
    "permissions",
  );
  await expect(
    f.search.openCitation({
      ...first.citations[0],
      locator: {
        ...first.citations[0].locator,
        path: "forged.txt",
      },
    }),
  ).rejects.toThrow("BLK-KNOWLEDGE-CITATION");
  f.denyOnFinal();
  await expect(f.search.query("cache")).rejects.toThrow(
    "BLK-KNOWLEDGE-CONFLICT",
  );
});
it("requires explicit fallback and identifies genuine vector result provenance", async () => {
  const f = await fixture();
  await expect(f.search.query("cache", { strategy: "vector" })).rejects.toThrow(
    "BLK-EMBED-MISSING",
  );
  expect(
    await f.search.query("cache", { strategy: "vector", fallback: "keyword" }),
  ).toMatchObject({
    strategy: "keyword",
    warning: "BLK-KNOWLEDGE-KEYWORD-FALLBACK",
  });
  f.allowVector();
  expect(await f.search.query("cache", { strategy: "hybrid" })).toMatchObject({
    strategy: "hybrid",
    embedding: { dimension: 384, externalApi: false },
    status: "found",
  });
  expect(
    (await f.search.query("cache", { filters: { sourceId: "other" } }))
      .citations,
  ).toHaveLength(0);
});
