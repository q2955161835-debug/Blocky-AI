import { expect, it } from "vitest";
import { knowledgeResource, resourceRetrieval } from "../src/resource";
it("round trips every retrieval setting shared by the resource editor and runtime", () => {
  const resource = knowledgeResource("collection", "Sources", {
    strategy: "hybrid",
    topK: 3,
    maxCandidates: 18,
    contextBudget: 700,
    minScore: 0.4,
    rerank: false,
    timeoutMs: 500,
    fallback: "keyword",
    filters: { language: "en", sourceId: "s" },
  });
  expect(resourceRetrieval(resource.definition)).toMatchObject({
    strategy: "hybrid",
    topK: 3,
    maxCandidates: 18,
    contextBudget: 700,
    minScore: 0.4,
    rerank: false,
    timeoutMs: 500,
    fallback: "keyword",
    filters: { language: "en", sourceId: "s" },
  });
  const altered = structuredClone(resource.definition);
  (altered.retrieval as Record<string, unknown>).rerankResourceId =
    "unavailable";
  expect(() => resourceRetrieval(altered)).toThrow("BLK-KNOWLEDGE-RERANK");
});
