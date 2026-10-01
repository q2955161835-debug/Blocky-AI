import { z } from "zod";
import { canonicalJson } from "@blocky/language-schema";
import type { KnowledgeState } from "./types";
const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/)
  .refine((s) => !["__proto__", "constructor", "prototype"].includes(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const locator = z
  .object({
    path: z.string().max(2048),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    url: z.string().max(8192).optional(),
    commit: z.string().max(100).optional(),
    page: z.number().int().min(1).max(1000000).optional(),
    paragraph: z.number().int().min(1).max(1000000).optional(),
    row: z.number().int().min(1).max(1000000).optional(),
    sheet: z.string().min(1).max(256).optional(),
    cellRange: z.string().min(1).max(256).optional(),
    region: z
      .object({
        x: z.number().min(0).max(100000),
        y: z.number().min(0).max(100000),
        width: z.number().positive().max(100000),
        height: z.number().positive().max(100000),
        unit: z.literal("pixel"),
      })
      .strict()
      .optional(),
  })
  .strict();
const chunk = z
  .object({
    chunkId: id,
    sourceId: id,
    documentId: id,
    title: z.string().max(2048),
    text: z.string().max(32000),
    digest: hash,
    revision: z.string().max(8192),
    locator,
    metadata: z.record(z.string(), z.string().max(8192)),
    tokens: z.number().int().positive(),
  })
  .strict();
const index = z
  .object({
    schemaVersion: z.literal("blocky.knowledge-index/v1"),
    generation: z.number().int().nonnegative(),
    sources: z.record(id, z.string().max(8192)),
    documents: z
      .array(
        z
          .object({
            sourceId: id,
            documentId: id,
            revision: z.string().max(8192),
            contentDigest: hash,
            chunkIds: z.array(id).max(200000),
          })
          .strict(),
      )
      .max(100000),
    chunks: z.array(chunk).max(250000),
    chunking: z
      .object({
        size: z.number().int().min(1).max(16000),
        overlap: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const counts = z
  .object({
    added: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
  })
  .strict();
const state = z
  .object({
    schemaVersion: z.literal("blocky.knowledge-store/v1"),
    index: index.nullable(),
    pending: z
      .object({
        index,
        chunkRefs: z.array(id).max(250000).optional(),
        checkpoints: z
          .record(
            id,
            z
              .object({
                revision: z.string().max(8192),
                nextCursor: z.number().int().nonnegative().nullable(),
              })
              .strict(),
          )
          .default({}),
        completedSources: z.array(id).max(10000),
        failures: z
          .array(
            z
              .object({
                sourceId: id,
                code: z
                  .string()
                  .regex(/^BLK-(?:KNOWLEDGE|DOCUMENT|EMBED)-[A-Z-]+$/),
              })
              .strict(),
          )
          .max(10000),
        counts,
      })
      .strict()
      .nullable(),
  })
  .strict();
export function readKnowledgeState(input: unknown): KnowledgeState {
  if (input === null || input === undefined)
    return {
      schemaVersion: "blocky.knowledge-store/v1",
      index: null,
      pending: null,
    };
  const result = state.safeParse(input);
  if (!result.success) throw Error("BLK-KNOWLEDGE-STORE");
  if (result.data.pending?.chunkRefs) {
    const published = new Map(
      result.data.index?.chunks.map((c) => [c.chunkId, c]) ?? [],
    );
    const pending = result.data.pending;
    for (const id of pending.chunkRefs!) {
      const chunk = published.get(id);
      if (!chunk || !(chunk.sourceId in pending.index.sources))
        throw Error("BLK-KNOWLEDGE-STORE");
      pending.index.chunks.push(chunk);
    }
    if (pending.index.chunks.length > 250000)
      throw Error("BLK-KNOWLEDGE-STORE");
    delete pending.chunkRefs;
  }
  for (const value of [result.data.index, result.data.pending?.index]) {
    if (!value) continue;
    if (value.chunking.overlap >= value.chunking.size)
      throw Error("BLK-KNOWLEDGE-STORE");
    const ids = new Set(value.chunks.map((c) => c.chunkId));
    const chunksById = new Map(value.chunks.map((c) => [c.chunkId, c]));
    if (
      ids.size !== value.chunks.length ||
      value.chunks.some((c) => !(c.sourceId in value.sources)) ||
      value.documents.some(
        (d) =>
          !(d.sourceId in value.sources) ||
          d.chunkIds.some((id) => {
            const chunk = chunksById.get(id);
            return (
              !chunk ||
              chunk.sourceId !== d.sourceId ||
              chunk.documentId !== d.documentId ||
              chunk.revision !== d.revision
            );
          }),
      )
    )
      throw Error("BLK-KNOWLEDGE-STORE");
  }
  return result.data;
}
/** Published chunks remain authoritative; checkpoints reference unchanged objects
 * instead of serializing their text twice. This does not change the published index. */
export function writeKnowledgeState(value: KnowledgeState): unknown {
  if (!value.index || !value.pending) return value;
  const published = new Map(value.index.chunks.map((c) => [c.chunkId, c]));
  const chunkRefs: string[] = [],
    chunks = [];
  for (const chunk of value.pending.index.chunks) {
    const prior = published.get(chunk.chunkId);
    const same =
      prior &&
      (prior === chunk ||
        (prior.sourceId === chunk.sourceId &&
          prior.documentId === chunk.documentId &&
          prior.title === chunk.title &&
          prior.text === chunk.text &&
          prior.digest === chunk.digest &&
          prior.revision === chunk.revision &&
          prior.tokens === chunk.tokens &&
          canonicalJson(prior.locator) === canonicalJson(chunk.locator) &&
          canonicalJson(prior.metadata) === canonicalJson(chunk.metadata)));
    if (same) chunkRefs.push(chunk.chunkId);
    else chunks.push(chunk);
  }
  return {
    ...value,
    pending: {
      ...value.pending,
      index: { ...value.pending.index, chunks },
      chunkRefs,
    },
  };
}
