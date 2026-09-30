import { z } from "zod";
import { modelIdSchema } from "./model-schema";
export const toolIdSchema = modelIdSchema;
export const toolOutcomeSchema = z.enum([
  "confirmed-completed",
  "confirmed-not-applied",
]);
function boundedInput(value: unknown): boolean {
  const pending: [unknown, number][] = [[value, 0]];
  let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (depth > 32 || ++nodes > 8192) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean")
      continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item !== "object") return false;
    for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= 32768;
  } catch {
    return false;
  }
}
// Bound before recursive JSON parsing; shared shape also drives discovery.
const inputSchema = z
  .unknown()
  .refine(boundedInput, "输入超过 JSON 字节、深度或节点上限。")
  .pipe(z.json());
export const toolRequestSchema = z
  .object({
    schemaVersion: z.literal("blocky.tool-request/v2"),
    projectId: toolIdSchema,
    runId: toolIdSchema,
    requestId: toolIdSchema,
    resourceId: toolIdSchema,
    action: z.enum(["call", "discover", "read-resource"]),
    input: inputSchema,
    timeoutMs: z.number().int().min(1).max(120000),
  })
  .strict()
  .superRefine((request, ctx) => {
    const object =
      request.input !== null &&
      typeof request.input === "object" &&
      !Array.isArray(request.input)
        ? request.input
        : null;
    if (
      (request.action === "discover" &&
        (!object || Object.keys(object).length !== 0)) ||
      (request.action === "read-resource" &&
        (!object ||
          Object.keys(object).length !== 1 ||
          typeof object.uriRef !== "string" ||
          !/^uri-[a-f0-9]{64}$/.test(object.uriRef)))
    )
      ctx.addIssue({
        code: "custom",
        path: ["input"],
        message:
          "discover 需要空对象；read-resource 只接受发现结果中的 uriRef。",
      });
  });
