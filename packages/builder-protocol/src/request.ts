import { z } from "zod";
import { stableId } from "@blocky/language-schema";

const id = z.string().regex(stableId).max(200);
export const builderTools = ["inspect", "draft", "patch", "verify"] as const;
export const builderWorkIds = [
  "build-blocky-agents",
  "create-blocky-blocks",
  "convert-github-project-to-blocky",
  "reverse-agent-to-blocky",
] as const;
export const builderRequestSchema = z
  .object({
    schemaVersion: z.literal("blocky.builder-request/v1"),
    requestId: id,
    projectId: id,
    intent: z.enum(["build", "explain", "repair"]),
    prompt: z.string().trim().min(1).max(16000),
    moduleId: id,
    selection: z
      .array(id)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    createSurface: z.boolean(),
  })
  .strict();
export type BuilderRequest = z.infer<typeof builderRequestSchema>;
export const draftInputSchema = z
  .object({
    plan: z.array(z.string().trim().min(1).max(1000)).min(1).max(12),
    acceptanceCriteria: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(12),
    explanation: z.string().max(8000).optional(),
  })
  .strict();
export type BuildSpec = z.infer<typeof draftInputSchema> & {
  schemaVersion: "blocky.build/v1";
  requestId: string;
  projectId: string;
  baseDigest: string;
  intent: BuilderRequest["intent"];
  targetModuleIds: string[];
  selectedBlockIds: string[];
  createSurface: boolean;
};
/** Reject credentials in user/engine text before it can enter a candidate or log. */
export function builderInputBudget(input: unknown) {
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 30000 || depth > 80) throw Error("BLK-BUILDER-001");
    if (
      typeof value === "string" &&
      /\bBearer\s+\S+|(?:password|token|api[_-]?key)\s*[=:]\s*\S+/i.test(value)
    )
      throw Error("BLK-BUILDER-001");
    if (value && typeof value === "object")
      Object.values(value).forEach((v) => visit(v, depth + 1));
  };
  visit(input, 0);
  if (new TextEncoder().encode(JSON.stringify(input)).length > 128000)
    throw Error("BLK-BUILDER-001");
}
export function parseBuilderRequest(input: unknown): BuilderRequest {
  try {
    builderInputBudget(input);
    return builderRequestSchema.parse(input);
  } catch {
    throw Error("BLK-BUILDER-001");
  }
}
