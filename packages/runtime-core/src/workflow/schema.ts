import { z } from "zod";
import { stableId } from "@blocky/language-schema";
import type { WorkflowSummary } from "./runtime";

export const workflowIdSchema = z.string().max(128).regex(stableId);
const direction = z.enum(["forward", "rollback"]);
const receipt = z
  .object({
    stepId: workflowIdSchema,
    status: z.enum([
      "pending",
      "completed",
      "approved",
      "rejected",
      "compensated",
      "skipped",
    ]),
  })
  .strict();
/** Public summary only. Reject rather than strip unexpected private fields. */
export const workflowSummarySchema = z
  .object({
    schemaVersion: z.literal("blocky.workflow-summary/v1"),
    taskId: workflowIdSchema,
    projectId: workflowIdSchema,
    moduleId: workflowIdSchema,
    blockId: workflowIdSchema,
    planDigest: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().min(1).max(65535),
    status: z.enum([
      "ready",
      "executing",
      "awaiting-approval",
      "paused",
      "compensating",
      "undoing",
      "uncertain",
      "completed",
      "compensated",
    ]),
    phase: direction,
    cursor: z.number().int().min(-1).max(64),
    forwardCursor: z.number().int().min(0).max(64),
    totalSteps: z.number().int().min(1).max(64),
    stepId: workflowIdSchema.optional(),
    active: z
      .object({
        stepId: workflowIdSchema,
        direction,
        effectKey: z
          .string()
          .max(267)
          .regex(/^[a-z0-9._-]+:[a-z0-9._-]+:(forward|rollback)$/),
      })
      .strict()
      .optional(),
    code: z.enum(["BLK-WORKFLOW-EFFECT", "BLK-WORKFLOW-CANCELLED"]).optional(),
    receipts: z.array(receipt).min(1).max(64),
    resolutions: z
      .array(
        z
          .object({
            revision: z.number().int().min(1).max(65535),
            stepId: workflowIdSchema,
            direction,
            outcome: z.enum(["completed", "not-executed"]),
          })
          .strict(),
      )
      .max(128),
  })
  .strict() satisfies z.ZodType<WorkflowSummary>;

export const workflowDecisionResultSchema = z.discriminatedUnion("applied", [
  z
    .object({
      applied: z.literal(false),
      requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
      task: workflowSummarySchema,
      after: workflowSummarySchema,
    })
    .strict(),
  z
    .object({
      applied: z.literal(true),
      requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
      task: workflowSummarySchema,
    })
    .strict(),
]);

const reconciliationFields = {
  projectId: workflowIdSchema,
  taskId: workflowIdSchema,
  stepId: workflowIdSchema,
  revision: z.number().int().min(1).max(65535),
  direction,
  approval: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
};
export const workflowReconciliationSchema = z.discriminatedUnion("outcome", [
  z
    .object({ ...reconciliationFields, outcome: z.literal("not-executed") })
    .strict(),
  z
    .object({
      ...reconciliationFields,
      outcome: z.literal("completed"),
      state: z.json(),
    })
    .strict(),
]);
