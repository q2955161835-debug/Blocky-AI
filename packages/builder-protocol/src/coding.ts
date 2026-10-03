import { z } from "zod";
import {
  stableId,
  containsCredential,
  type Project,
} from "@blocky/language-schema";
import { parseProject } from "@blocky/project-model";

const id = z.string().regex(stableId).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const codingTools = [
  "workspace_list",
  "workspace_search",
  "workspace_read",
  "workspace_write",
  "workspace_undo",
  "workspace_check",
  "blocky_cli",
  "project_context",
] as const;
export type CodingTool = (typeof codingTools)[number];
export const codingConversationSchema = z
  .array(
    z
      .object({
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(16000),
      })
      .strict(),
  )
  .max(20)
  .refine(
    (messages) =>
      messages.reduce((sum, message) => sum + message.text.length, 0) <= 64000,
  );
const contextCode = z.string().regex(/^BLK-[A-Z0-9-]{1,124}$/).max(128);
export const codingRuntimeContextSchema = z
  .object({
    diagnostics: z
      .array(
        z
          .object({
            code: contextCode,
            severity: z.enum(["info", "warning", "error"]),
            moduleId: id.optional(),
            blockId: id.optional(),
          })
          .strict(),
      )
      .max(20),
    recentEvents: z
      .array(
        z
          .object({
            type: z.string().min(1).max(64),
            moduleId: id.optional(),
            blockId: id.optional(),
            code: contextCode.optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (new TextEncoder().encode(JSON.stringify(context)).length > 8192)
      refinement.addIssue({ code: "custom", message: "BLK-CODING-INPUT" });
  });
export type CodingRuntimeContext = z.infer<typeof codingRuntimeContextSchema>;
export const codingStartSchema = z
  .object({
    schemaVersion: z.literal("blocky.coding-start/v1"),
    requestId: id,
    projectId: id,
    moduleId: id,
    prompt: z.string().trim().min(1).max(16000),
    originalJson: z.string().max(8 * 1024 * 1024),
    resourceId: id,
    selection: z
      .array(id)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    conversation: codingConversationSchema,
    workspaceId: id.optional(),
    runtimeContext: codingRuntimeContextSchema.optional(),
  })
  .strict();
export type CodingStart = z.infer<typeof codingStartSchema>;
export const codingWorkspaceSchema = z
  .object({ workspaceId: id, displayName: z.string().min(1).max(512) })
  .strict();
export const codingMessageSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
    role: z.enum(["user", "assistant"]),
    text: z
      .string()
      .min(1)
      .max(16000)
      .refine((text) => !containsCredential(text)),
    status: z
      .enum([
        "completed",
        "proposed",
        "accepted",
        "rejected",
        "failed",
        "cancelled",
        "stale",
      ])
      .optional(),
  })
  .strict();
export type CodingMessage = z.infer<typeof codingMessageSchema>;
export const codingChatStateSchema = z
  .object({
    schemaVersion: z.literal("blocky.coding-chat/v1"),
    projectId: id,
    messages: z
      .array(codingMessageSchema)
      .max(40)
      .refine(
        (messages) =>
          messages.reduce((sum, message) => sum + message.text.length, 0) <=
          64000,
      ),
  })
  .strict();
const relativePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (path) =>
      !/[\\:\x00-\x1f]/.test(path) &&
      !path.startsWith("/") &&
      path
        .split("/")
        .every(
          (part) =>
            part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part),
        ),
  );
export const codingChangeSchema = z
  .object({
    changeId: id,
    revertsChangeId: id.optional(),
    invalidatesChangeId: id.optional(),
    path: relativePath,
    before: z
      .string()
      .max(1024 * 1024)
      .nullable(),
    after: z
      .string()
      .max(1024 * 1024)
      .nullable(),
    beforeDigest: digest.nullable(),
    afterDigest: digest.nullable(),
  })
  .strict()
  .refine(
    (change) =>
      change.revertsChangeId !== change.changeId &&
      change.invalidatesChangeId !== change.changeId &&
      !(change.revertsChangeId && change.invalidatesChangeId),
  )
  .refine(
    (change) =>
      (change.before === null) === (change.beforeDigest === null) &&
      (change.after === null) === (change.afterDigest === null),
  );
export type CodingChange = z.infer<typeof codingChangeSchema>;
export const codingChangesSchema = z.array(codingChangeSchema).max(512);
export const codingEventSchema = z
  .object({
    schemaVersion: z.literal("blocky.coding-event/v1"),
    requestId: id,
    projectId: id,
    sequence: z.number().int().positive(),
    kind: z.enum([
      "text.delta",
      "tool.started",
      "tool.completed",
      "tool.failed",
      "file.changed",
    ]),
    tool: z.enum(codingTools).optional(),
    callId: z.string().min(1).max(128).optional(),
    text: z.string().max(16384).optional(),
    code: z
      .string()
      .regex(/^BLK-[A-Z0-9-]+$/)
      .max(128)
      .optional(),
    change: codingChangeSchema.optional(),
  })
  .strict();
export type CodingEvent = z.infer<typeof codingEventSchema>;
const generationSchema = z
  .object({
    schemaVersion: z.literal("blocky.model-response/v2").optional(),
    usageStatus: z.enum(["reported", "unavailable"]).optional(),
    localInference: z.boolean().optional(),
    externalApi: z.boolean().optional(),
    provider: z.string().max(200),
    model: z.string().max(200),
    requestId: z.string().max(200),
    transport: z.string().max(100),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();
const projectSchema = z.unknown().transform((input, context): Project => {
  try {
    return parseProject(input);
  } catch {
    context.addIssue({ code: "custom", message: "BLK-CODING-PROJECT" });
    return z.NEVER;
  }
});
export const codingResultSchema = z
  .object({
    schemaVersion: z.literal("blocky.coding-result/v1"),
    requestId: id,
    projectId: id,
    baseDigest: digest,
    text: z.string().max(64000),
    changes: z.array(codingChangeSchema).max(128),
    events: z.array(codingEventSchema).max(2048),
    generations: z.array(generationSchema).max(12),
    engine: z.string().min(1).max(200),
    modelApiCalled: z.boolean(),
    project: projectSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.project && value.project.manifest.projectId !== value.projectId)
      context.addIssue({ code: "custom", message: "BLK-CODING-PROJECT" });
    let sequence = 0;
    for (const event of value.events) {
      if (
        event.requestId !== value.requestId ||
        event.projectId !== value.projectId ||
        event.sequence <= sequence
      )
        context.addIssue({ code: "custom", message: "BLK-CODING-EVENT" });
      sequence = event.sequence;
    }
    if (
      new Set(value.changes.map((change) => change.changeId)).size !==
      value.changes.length
    )
      context.addIssue({ code: "custom", message: "BLK-CODING-CHANGE" });
  });
export type CodingResult = z.infer<typeof codingResultSchema>;
export function parseCodingStart(input: unknown): CodingStart {
  try {
    const parsed = codingStartSchema.parse(input);
    if (
      containsCredential(parsed.prompt) ||
      parsed.conversation.some((message) => containsCredential(message.text))
    )
      throw Error("credential");
    if (
      new TextEncoder().encode(JSON.stringify(parsed)).length >
      9 * 1024 * 1024
    )
      throw Error("budget");
    return parsed;
  } catch {
    throw Error("BLK-CODING-INPUT");
  }
}

/** Bound UTF-16 units without sending an unpaired surrogate through native JSON. */
export function codingTextPrefix(text: string, limit: number): string {
  let end = Math.min(text.length, limit);
  if (
    end > 0 &&
    end < text.length &&
    text.charCodeAt(end - 1) >= 0xd800 &&
    text.charCodeAt(end - 1) <= 0xdbff &&
    text.charCodeAt(end) >= 0xdc00 &&
    text.charCodeAt(end) <= 0xdfff
  )
    end--;
  return text.slice(0, end);
}
