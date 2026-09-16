import { z } from "zod";
import { stableId, validRef } from "@blocky/language-schema";
import { workspaceBlockShape } from "@blocky/block-catalog";
import { draftSchema } from "@blocky/app-surface";
const id = z.string().regex(stableId).max(200);
const source = { moduleId: id, blockId: id };
const operation = z.discriminatedUnion("op", [
  draftSchema.extend({ op: z.literal("app-surface.add") }).strict(),
  z
    .object({
      op: z.literal("block.add"),
      ...source,
      payload: workspaceBlockShape,
    })
    .strict(),
  z
    .object({
      op: z.literal("block.update"),
      ...source,
      payload: z
        .object({ fields: z.record(z.string(), z.string().max(16000)) })
        .strict(),
    })
    .strict(),
  z
    .object({
      op: z.literal("block.move"),
      ...source,
      payload: z
        .object({
          x: z.number().finite().min(-100000).max(100000),
          y: z.number().finite().min(-100000).max(100000),
        })
        .strict(),
    })
    .strict(),
  z.object({ op: z.literal("block.remove"), ...source }).strict(),
]);
const diagnosticSource = z
  .object({
    projectId: id,
    moduleId: id.optional(),
    blockId: id.optional(),
    fileRef: z.string().refine(validRef).optional(),
  })
  .strict();
const diagnostic = z
  .object({
    schemaVersion: z.literal("blocky.diagnostic/v1alpha1"),
    diagnosticId: z.string().max(300),
    code: z.string().max(100),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().max(16000),
    source: diagnosticSource.optional(),
    related: z.array(diagnosticSource).max(100),
  })
  .strict();
const patch = z
  .object({
    schemaVersion: z.literal("blocky.patch/v1alpha1"),
    patchId: id,
    projectId: id,
    baseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    catalogVersion: z.string().max(50),
    operations: z.array(operation).min(1).max(500),
    permissionDelta: z.array(z.string().min(1).max(200)).max(100),
    diagnostics: z.array(diagnostic).max(100),
  })
  .strict();
export type SemanticPatch = z.infer<typeof patch>;
export type PatchOperation = SemanticPatch["operations"][number];
export function parsePatch(input: unknown): SemanticPatch {
  try {
    let nodes = 0;
    const walk = (v: unknown, depth: number) => {
      if (++nodes > 30000 || depth > 100) throw Error("budget");
      if (
        typeof v === "string" &&
        /\bBearer\s+\S+|(?:password|token|api[_-]?key)\s*[=:]\s*\S+/i.test(v)
      )
        throw Error("credential");
      if (v && typeof v === "object")
        Object.values(v).forEach((x) => walk(x, depth + 1));
    };
    walk(input, 0);
    return patch.parse(structuredClone(input));
  } catch {
    throw Error("BLK-PATCH-002");
  }
}
