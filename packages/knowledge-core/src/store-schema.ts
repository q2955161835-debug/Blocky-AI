import { z } from "zod";
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
                code: z.string().regex(/^BLK-KNOWLEDGE-[A-Z]+$/),
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
  for (const value of [result.data.index, result.data.pending?.index]) {
    if (!value) continue;
    if (value.chunking.overlap >= value.chunking.size)
      throw Error("BLK-KNOWLEDGE-STORE");
    const ids = new Set(value.chunks.map((c) => c.chunkId));
    if (
      ids.size !== value.chunks.length ||
      value.documents.some((d) => d.chunkIds.some((c) => !ids.has(c)))
    )
      throw Error("BLK-KNOWLEDGE-STORE");
  }
  return result.data;
}
