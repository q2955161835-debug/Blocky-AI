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
  let rerankForged = false;
  let rerankInput: Record<string, unknown> | undefined;
  const call = async (op: string, fields: Record<string, unknown> = {}) => {
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
    if (op === "knowledge-rerank") {
      rerankInput = fields;
      return {
        modelId: "ms-marco-minilm-l6-v2-int8-v1",
        indexRevision: revision,
        generation,
        modelSha256: "b".repeat(64),
        hits: [
          { chunkId: rerankForged ? "foreign" : chunks[0].chunkId, score: -2 },
        ],
      };
    }
    throw Error(op);
  };
  return {
    search: new KnowledgeSearch(call, "p", "c"),
    chunks,
    get loads() {
      return loadCount;
    },
    denyOnNextHead() {
      denyAt = heads + 1;
    },
    denyOnFinal() {
      denyAt = heads + 2;
    },
    allowVector() {
      vectorFailure = false;
    },
    forgeRerank() {
      rerankForged = true;
    },
    get rerankInput() {
      return rerankInput;
    },
  };
}
it("uses neural logits only for ordering authorized candidates and rechecks the source epoch", async () => {
  const f = await fixture();
  const options = { rerankModelId: "ms-marco-minilm-l6-v2-int8-v1" };
  const result = await f.search.query("cache permissions", options);
  expect(result.reranking?.scoreMeaning).toBe("sigmoid-logit-not-probability");
  expect(result.citations[0].score).toBeCloseTo(1 / (1 + Math.exp(2)));
  expect(f.rerankInput?.chunkIds).toEqual([f.chunks[0].chunkId]);
  expect(f.rerankInput).not.toHaveProperty("texts");
  f.forgeRerank();
  await expect(f.search.query("cache permissions", options)).rejects.toThrow(
    "BLK-KNOWLEDGE-RERANK",
  );
  const revoked = await fixture();
  revoked.denyOnFinal();
  await expect(
    revoked.search.query("cache permissions", options),
  ).rejects.toThrow("BLK-KNOWLEDGE-CONFLICT");
});
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

it("corrects weak retrieval within a fixed rewrite bound and never returns rejected evidence", async () => {
  const { correctedQuery } = await import("../src/correction");
  const f = await fixture();
  const original = "unrelated-input";
  const decisions: string[] = [];
  const result = await correctedQuery(
    f.search,
    original,
    {},
    async (input) => {
      decisions.push(input.query);
      expect(input.originalQuestion).toBe(original);
      return input.citations.length
        ? { action: "accept" }
        : { action: "rewrite", query: "Cache entries expire" };
    },
    1,
  );
  expect(result.status).toBe("found");
  expect(result.citations.length).toBeGreaterThan(0);
  expect(result.correction).toMatchObject({ rewrites: 1, judgments: 2 });
  expect(decisions).toEqual([original, "Cache entries expire"]);
  const rejected = await correctedQuery(
    f.search,
    "Cache entries expire",
    {},
    async () => ({ action: "clarify" }),
    1,
  );
  expect(rejected.status).toBe("no-evidence");
  expect(rejected.citations).toEqual([]);
});
it("rejects repeated rewrites, malformed judgments and results revoked while the model judges", async () => {
  const { correctedQuery } = await import("../src/correction");
  const f = await fixture();
  const exhausted = await correctedQuery(
    f.search,
    "Cache",
    {},
    async () => ({ action: "rewrite", query: "Cache" }),
    2,
  );
  expect(exhausted.citations).toEqual([]);
  expect(exhausted.correction.judgments).toBe(1);
  await expect(
    correctedQuery(
      f.search,
      "Cache",
      {},
      async () => ({ action: "accept", execute: "shell" }),
      1,
    ),
  ).rejects.toThrow("BLK-KNOWLEDGE-JUDGMENT");
  await expect(
    correctedQuery(
      f.search,
      "Cache",
      {},
      async () => {
        f.denyOnNextHead();
        return { action: "accept" };
      },
      1,
    ),
  ).rejects.toThrow("BLK-KNOWLEDGE-CONFLICT");
});
