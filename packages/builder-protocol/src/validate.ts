import { z } from "zod";
import { stableId } from "@blocky/language-schema";
const id = z.string().regex(stableId).max(200);
const source = { moduleId: id, blockId: id };
const operation = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("block.add"), ...source, payload: z.unknown() })
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
const patch = z
  .object({
    schemaVersion: z.literal("blocky.patch/v1alpha1"),
    patchId: id,
    projectId: id,
    baseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    catalogVersion: z.string().max(50),
    operations: z.array(operation).min(1).max(500),
    permissionDelta: z.array(z.string().min(1).max(200)).max(100),
    diagnostics: z.array(z.unknown()).max(100),
  })
  .strict();
export type SemanticPatch = z.infer<typeof patch>;
export type PatchOperation = SemanticPatch["operations"][number];
export function parsePatch(input: unknown): SemanticPatch {
  try {
    let nodes = 0;
    const walk = (v: unknown, depth: number) => {
      if (++nodes > 30000 || depth > 100) throw Error("budget");
      if (v && typeof v === "object")
        Object.values(v).forEach((x) => walk(x, depth + 1));
    };
    walk(input, 0);
    return patch.parse(structuredClone(input));
  } catch {
    throw Error("BLK-PATCH-002");
  }
}
