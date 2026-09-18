import { z } from "zod";
import { validRef } from "@blocky/language-schema";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const artifactSchema = z.object({
  artifactId: z.string().regex(/^art-[a-f0-9]{64}$/),
  sha256: hash,
  bytes: z
    .number()
    .int()
    .nonnegative()
    .max(240 * 1024 * 1024),
  snapshotId: z.string().regex(/^snap-[a-f0-9]{64}$/),
  commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  fileCount: z.number().int().nonnegative().max(20000),
  subdir: z.string().max(1000),
  repository: z.literal("local-repository"),
  dirty: z.enum(["true", "false", "unknown"]),
  excludedCount: z.number().int().nonnegative(),
});
export type SourceArtifact = z.infer<typeof artifactSchema>;
export const fileSchema = z
  .object({
    path: z.string().max(1000).refine(validRef),
    sha256: hash,
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 * 1024),
    content: z.string().max(2 * 1024 * 1024),
  })
  .strict();
export type SourceFile = z.infer<typeof fileSchema>;
export const pageSchema = z.object({
  schemaVersion: z.literal("blocky.source-snapshot/v1"),
  snapshotId: z.string(),
  commit: z.string(),
  repository: z.literal("local-repository"),
  subdir: z.string(),
  readPolicy: z.literal("locked-commit"),
  dirty: z.enum(["true", "false", "unknown"]),
  dirtyScope: z.string(),
  dirtyChecked: z.number(),
  dirtyChanged: z.number(),
  dirtyUnchecked: z.number(),
  files: z.array(fileSchema).max(64),
  excluded: z.array(z.object({ path: z.string(), reason: z.string() })),
  excludedCount: z.number(),
  excludedTruncated: z.boolean(),
  nextCursor: z.number().int().nonnegative().nullable(),
  artifactId: z.string(),
  sha256: hash,
  bytes: z.number(),
});
export async function verifyFile(file: SourceFile) {
  const bytes = new TextEncoder().encode(file.content);
  const actual = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (bytes.length !== file.bytes || actual !== file.sha256)
    throw Error("BLK-CONVERT-CORRUPT");
}
