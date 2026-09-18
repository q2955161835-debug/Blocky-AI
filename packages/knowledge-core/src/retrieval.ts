import { z } from "zod";
import { rankOrder, terms, type ScoredChunk } from "./keyword";
import type { Chunk, Locator } from "./types";
const config = z
  .object({
    strategy: z.enum(["keyword", "vector", "hybrid"]).default("keyword"),
    topK: z.number().int().min(1).max(20).default(5),
    maxCandidates: z.number().int().min(1).max(200).default(40),
    minScore: z.number().min(0).max(1).default(0),
    contextBudget: z.number().int().min(64).max(64000).default(4000),
    rerank: z.boolean().default(true),
    timeoutMs: z.number().int().min(50).max(120000).default(10000),
    fallback: z.enum(["error", "keyword"]).default("error"),
    modelId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)
      .default("multilingual-e5-small-int8-v1"),
    filters: z.record(z.string().max(100), z.string().max(1000)).default({}),
  })
  .strict()
  .refine((c) => c.maxCandidates >= c.topK);
export type RetrievalOptions = z.infer<typeof config>;
export function retrievalOptions(input: unknown = {}): RetrievalOptions {
  const result = config.safeParse(input);
  if (!result.success) throw Error("BLK-KNOWLEDGE-CONFIG");
  return result.data;
}
export type EvidenceCitation = {
  id: string;
  title: string;
  text: string;
  sourceId: string;
  documentId: string;
  revision: string;
  digest: string;
  locator: Locator;
  score: number;
  truncated: boolean;
  collectionId?: string;
};
export function matchesMetadata(
  chunk: Chunk,
  filters: Record<string, string>,
): boolean {
  return Object.entries(filters).every(([key, value]) =>
    key === "sourceId"
      ? chunk.sourceId === value
      : key === "documentId"
        ? chunk.documentId === value
        : chunk.metadata[key] === value,
  );
}
const bytes = (text: string) => new TextEncoder().encode(text).length;
function clip(text: string, limit: number) {
  let result = "",
    used = 0;
  for (const point of text) {
    const size = bytes(point);
    if (used + size > limit) break;
    result += point;
    used += size;
  }
  return result;
}
export function selectEvidence(
  query: string,
  chunks: Chunk[],
  hits: ScoredChunk[],
  options: RetrievalOptions,
) {
  const byId = new Map(chunks.map((c) => [c.chunkId, c])),
    queryTerms = new Set(terms(query));
  const ranked = hits
    .filter((h) => h.score >= options.minScore && byId.has(h.chunkId))
    .slice(0, options.maxCandidates)
    .map((hit) => {
      if (!options.rerank) return hit;
      const chunk = byId.get(hit.chunkId)!,
        body = new Set(terms(chunk.text)),
        title = new Set(terms(chunk.title));
      let covered = 0,
        titleCovered = 0;
      for (const term of queryTerms) {
        if (body.has(term)) covered++;
        if (title.has(term)) titleCovered++;
      }
      const score =
        0.6 * hit.score +
        (0.3 * covered) / Math.max(1, queryTerms.size) +
        (0.1 * titleCovered) / Math.max(1, queryTerms.size);
      return { ...hit, score };
    })
    .sort(rankOrder);
  const citations: EvidenceCitation[] = [],
    seen = new Set<string>();
  let contextBytes = 0;
  for (const hit of ranked) {
    if (citations.length >= options.topK) break;
    const chunk = byId.get(hit.chunkId)!;
    if (seen.has(chunk.digest)) continue;
    const title = `${chunk.title} (${chunk.locator.path}:${chunk.locator.lineStart}–${chunk.locator.lineEnd})`;
    const overhead = bytes(title) + bytes(chunk.chunkId) + 8;
    const remaining = options.contextBudget - contextBytes - overhead;
    if (remaining < 16) continue;
    const text = clip(chunk.text, remaining);
    if (!text) continue;
    citations.push({
      id: chunk.chunkId,
      title,
      text,
      sourceId: chunk.sourceId,
      documentId: chunk.documentId,
      revision: chunk.revision,
      digest: chunk.digest,
      locator: chunk.locator,
      score: hit.score,
      truncated: text.length < chunk.text.length,
    });
    contextBytes += overhead + bytes(text);
    seen.add(chunk.digest);
  }
  return { citations, contextBytes, ranked };
}
