import { stableId } from "@blocky/language-schema";
import { z } from "zod";
import { triggerConfigSchema, type TriggerConfig } from "./triggers";

const id = z.string().max(128).regex(stableId);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const epoch = z.number().int().nonnegative().max(8_640_000_000_000_000);
const opaque = z.string().min(1).max(512).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const common = {
  schemaVersion: z.literal("blocky.trigger-request/v1"),
  requestId: id,
  projectId: id,
  sessionId: id,
};
const timerOccurrence = z.object({
  occurrenceId: opaque,
  scheduledAt: epoch,
  kind: z.literal("timer"),
}).strict();
const externalOccurrence = z.object({
  occurrenceId: opaque,
  scheduledAt: epoch,
  kind: z.literal("external"),
  eventId: id,
}).strict();
export const triggerOccurrenceRequestSchema = z.discriminatedUnion("kind", [
  timerOccurrence,
  externalOccurrence,
]);

export const triggerRequestSchema = z.union([
  z.object({ ...common, action: z.literal("list") }).strict(),
  z.object({ ...common, action: z.literal("read"), triggerId: id }).strict(),
  z.object({
    ...common,
    action: z.literal("upsert"),
    expectedRevision: revision.nullable(),
    config: triggerConfigSchema,
  }).strict(),
  z.object({
    ...common,
    action: z.literal("pause"),
    triggerId: id,
    expectedRevision: revision,
    paused: z.boolean(),
  }).strict(),
  z.object({
    ...common,
    action: z.literal("claim"),
    triggerId: id,
    expectedRevision: revision,
    occurrence: triggerOccurrenceRequestSchema,
  }).strict(),
  z.union([
    z.object({
      ...common,
      action: z.literal("complete"),
      triggerId: id,
      occurrenceId: opaque,
      claimRevision: revision,
      status: z.literal("completed"),
      workflowTaskId: id,
    }).strict(),
    z.object({
      ...common,
      action: z.literal("complete"),
      triggerId: id,
      occurrenceId: opaque,
      claimRevision: revision,
      status: z.literal("failed"),
      workflowTaskId: id,
      stableErrorCode: z.string().max(128).regex(/^BLK-(?:[A-Z0-9]+-)*[A-Z0-9]+$/u),
    }).strict(),
  ]),
]);
export type TriggerRequest = z.infer<typeof triggerRequestSchema>;

export const triggerRecordSchema = z.object({
  projectId: id,
  triggerId: id,
  configRevision: revision,
  moduleId: id,
  exportId: id,
  occurrenceId: opaque,
  scheduledAt: epoch,
  kind: z.enum(["timer", "external"]),
  eventId: id.optional(),
  claimRevision: revision,
  status: z.enum(["claimed", "completed", "failed"]),
  workflowTaskId: id.optional(),
  stableErrorCode: z.string().max(128).regex(/^BLK-(?:[A-Z0-9]+-)*[A-Z0-9]+$/u).optional(),
}).strict().superRefine((record, ctx) => {
  if ((record.status === "claimed" && (record.claimRevision !== 1 || record.workflowTaskId !== undefined || record.stableErrorCode !== undefined)) ||
    (record.status === "completed" && (record.claimRevision !== 2 || !record.workflowTaskId || record.stableErrorCode !== undefined)) ||
    (record.status === "failed" && (record.claimRevision !== 2 || !record.workflowTaskId || !record.stableErrorCode)))
    ctx.addIssue({ code: "custom", message: "Trigger record settlement is inconsistent." });
});
export type TriggerRecord = z.infer<typeof triggerRecordSchema>;
export type TriggerOccurrenceRequest = z.infer<typeof triggerOccurrenceRequestSchema>;
const receiverCommon = {
  schemaVersion: z.literal("blocky.trigger-receiver-request/v1"),
  requestId: id,
  projectId: id,
  sessionId: id,
};
export const triggerReceiverRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...receiverCommon, action: z.literal("start"), triggerId: id, expectedRevision: revision, secretRef: id }).strict(),
  z.object({ ...receiverCommon, action: z.literal("poll"), receiverId: id }).strict(),
  z.object({ ...receiverCommon, action: z.literal("stop"), receiverId: id }).strict(),
]);
export type TriggerReceiverRequest = z.infer<typeof triggerReceiverRequestSchema>;
const receiverStartResponseSchema = z.object({ receiverId: id, endpoint: z.string().url().max(2048), configRevision: revision }).strict();
const receiverPollResponseSchema = z.object({
  receiverId: id,
  active: z.boolean(),
  events: z.array(z.object({
    occurrence: triggerRecordSchema,
    payload: z.json().refine((value) => {
      try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 32 * 1024; }
      catch { return false; }
    }),
  }).strict()).max(128),
}).strict();
const receiverStopResponseSchema = z.object({ receiverId: id, active: z.literal(false) }).strict();
export type TriggerListItem = {
  config: TriggerConfig;
  occurrences: TriggerRecord[];
};
export type TriggerCompletion =
  | { status: "completed"; workflowTaskId: string }
  | { status: "failed"; stableErrorCode: string; workflowTaskId: string };

const triggerListResponseSchema = z.object({
  triggers: z.array(z.object({
    config: triggerConfigSchema,
    occurrences: z.array(triggerRecordSchema).max(4096),
  }).strict()).max(128),
}).strict();
const triggerConfigResponseSchema = z.object({ config: triggerConfigSchema }).strict();
const claimResponseSchema = z.object({
  claimed: z.boolean(),
  record: triggerRecordSchema,
}).strict();
const recordResponseSchema = z.object({ record: triggerRecordSchema }).strict();

export interface TriggerClient {
  list(signal?: AbortSignal): Promise<TriggerListItem[]>;
  read(triggerId: string, signal?: AbortSignal): Promise<TriggerConfig | null>;
  upsert(config: TriggerConfig, expectedRevision: number | null, signal?: AbortSignal): Promise<TriggerConfig>;
  pause(triggerId: string, expectedRevision: number, paused: boolean, signal?: AbortSignal): Promise<TriggerConfig>;
  claim(triggerId: string, expectedRevision: number, occurrence: TriggerOccurrenceRequest, signal?: AbortSignal): Promise<{ claimed: boolean; record: TriggerRecord }>;
  complete(triggerId: string, occurrenceId: string, claimRevision: number, result: TriggerCompletion, signal?: AbortSignal): Promise<TriggerRecord>;
}

export interface TriggerReceiverClient {
  start(triggerId: string, expectedRevision: number, secretRef: string, signal?: AbortSignal): Promise<{ receiverId: string; endpoint: string; configRevision: number }>;
  poll(receiverId: string, signal?: AbortSignal): Promise<{ receiverId: string; active: boolean; events: { occurrence: TriggerRecord; payload: import("@blocky/language-schema").Json }[] }>;
  stop(receiverId: string, signal?: AbortSignal): Promise<void>;
}

export function createTriggerReceiverClient(options: {
  projectId: string;
  sessionId: string;
  send: (request: TriggerReceiverRequest, signal?: AbortSignal) => Promise<unknown>;
  newRequestId?: () => string;
}): TriggerReceiverClient {
  const bindings = new Map<string, { triggerId: string; revision: number }>();
  async function call<T>(action: TriggerReceiverRequest["action"], fields: Record<string, unknown>, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const parsed = triggerReceiverRequestSchema.safeParse({
      schemaVersion: "blocky.trigger-receiver-request/v1",
      requestId: options.newRequestId?.() ?? `trigger-${crypto.randomUUID()}`,
      projectId: options.projectId,
      sessionId: options.sessionId,
      action,
      ...fields,
    });
    if (!parsed.success) throw Error("BLK-TRIGGER-REQUEST");
    const result = await options.send(parsed.data, signal);
    const response = schema.safeParse(result);
    if (!response.success) throw Error("BLK-TRIGGER-RESPONSE");
    return response.data;
  }
  return {
    async start(triggerId, expectedRevision, secretRef, signal) {
      const response = await call("start", { triggerId, expectedRevision, secretRef }, receiverStartResponseSchema, signal);
      if (response.configRevision !== expectedRevision) throw Error("BLK-TRIGGER-BINDING");
      bindings.set(response.receiverId, { triggerId, revision: expectedRevision });
      return response;
    },
    async poll(receiverId, signal) {
      const response = await call("poll", { receiverId }, receiverPollResponseSchema, signal);
      const binding = bindings.get(receiverId);
      if (!binding || response.receiverId !== receiverId || response.events.some(({ occurrence }) =>
        occurrence.projectId !== options.projectId || occurrence.triggerId !== binding.triggerId ||
        occurrence.configRevision !== binding.revision || occurrence.kind !== "external" ||
        occurrence.status !== "claimed" || occurrence.claimRevision !== 1 || !occurrence.eventId))
        throw Error("BLK-TRIGGER-BINDING");
      return response;
    },
    async stop(receiverId, signal) {
      const response = await call("stop", { receiverId }, receiverStopResponseSchema, signal);
      if (response.receiverId !== receiverId) throw Error("BLK-TRIGGER-BINDING");
      bindings.delete(receiverId);
    },
  };
}

export function createTriggerClient(options: {
  projectId: string;
  sessionId: string;
  send: (request: TriggerRequest, signal?: AbortSignal) => Promise<unknown>;
  newRequestId?: () => string;
}): TriggerClient {
  function validateRequest(action: TriggerRequest["action"], fields: Record<string, unknown>): TriggerRequest {
    const parsed = triggerRequestSchema.safeParse({
      schemaVersion: "blocky.trigger-request/v1",
      requestId: options.newRequestId?.() ?? `trigger-${crypto.randomUUID()}`,
      projectId: options.projectId,
      sessionId: options.sessionId,
      action,
      ...fields,
    });
    if (!parsed.success) throw Error("BLK-TRIGGER-REQUEST");
    return parsed.data;
  }
  async function call<T>(
    action: TriggerRequest["action"],
    fields: Record<string, unknown>,
    responseSchema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const request = validateRequest(action, fields);
    const response = await options.send(request, signal);
    const parsed = responseSchema.safeParse(response);
    if (!parsed.success) throw Error("BLK-TRIGGER-RESPONSE");
    return parsed.data;
  }
  function bindConfig(config: TriggerConfig, expectedTriggerId?: string) {
    if (config.projectId !== options.projectId || (expectedTriggerId !== undefined && config.triggerId !== expectedTriggerId))
      throw Error("BLK-TRIGGER-BINDING");
    return config;
  }
  function responseConfig(config: TriggerConfig, expectedTriggerId?: string) {
    try {
      return bindConfig(config, expectedTriggerId);
    } catch {
      throw Error("BLK-TRIGGER-RESPONSE");
    }
  }
  function bindRecord(record: TriggerRecord, triggerId: string, expectedRevision?: number, occurrenceId?: string) {
    if (
      record.projectId !== options.projectId || record.triggerId !== triggerId ||
      (expectedRevision !== undefined && record.configRevision !== expectedRevision) ||
      (occurrenceId !== undefined && record.occurrenceId !== occurrenceId)
    ) throw Error("BLK-TRIGGER-BINDING");
    return record;
  }
  return {
    async list(signal) {
      const result = await call("list", {}, triggerListResponseSchema, signal);
      const seen = new Set<string>();
      return result.triggers.map(({ config: rawConfig, occurrences }) => {
        const config = responseConfig(rawConfig);
        if (seen.has(config.triggerId)) throw Error("BLK-TRIGGER-BINDING");
        seen.add(config.triggerId);
        return {
          config,
          occurrences: occurrences.map((record) => {
            bindRecord(record, config.triggerId);
            if (record.configRevision > config.revision) throw Error("BLK-TRIGGER-BINDING");
            return record;
          }),
        };
      });
    },
    async read(triggerId, signal) {
      const request = validateRequest("read", { triggerId });
      signal?.throwIfAborted();
      const response = await options.send(request, signal);
      if (response === null) return null;
      const parsed = triggerConfigSchema.safeParse(response);
      if (!parsed.success) throw Error("BLK-TRIGGER-RESPONSE");
      return responseConfig(parsed.data, triggerId);
    },
    async upsert(config, expectedRevision, signal) {
      const bound = bindConfig(config);
      const result = await call("upsert", { config: bound, expectedRevision }, triggerConfigResponseSchema, signal);
      return responseConfig(result.config, bound.triggerId);
    },
    async pause(triggerId, expectedRevision, paused, signal) {
      const result = await call("pause", { triggerId, expectedRevision, paused }, triggerConfigResponseSchema, signal);
      const config = responseConfig(result.config, triggerId);
      if (config.revision !== expectedRevision + 1 || config.enabled === paused) throw Error("BLK-TRIGGER-BINDING");
      return config;
    },
    async claim(triggerId, expectedRevision, occurrence, signal) {
      const result = await call("claim", { triggerId, expectedRevision, occurrence }, claimResponseSchema, signal);
      const record = bindRecord(result.record, triggerId, expectedRevision, occurrence.occurrenceId);
      if (record.kind !== occurrence.kind || (record.kind === "timer" && record.scheduledAt !== occurrence.scheduledAt))
        throw Error("BLK-TRIGGER-BINDING");
      if (result.claimed ? record.status !== "claimed" || record.claimRevision !== 1 : record.status === "claimed" && record.claimRevision !== 1)
        throw Error("BLK-TRIGGER-RESPONSE");
      return { claimed: result.claimed, record };
    },
    async complete(triggerId, occurrenceId, claimRevision, result, signal) {
      const response = await call("complete", { triggerId, occurrenceId, claimRevision, ...result }, recordResponseSchema, signal);
      const record = bindRecord(response.record, triggerId, undefined, occurrenceId);
      if (record.status !== result.status || record.claimRevision !== claimRevision + 1 || record.stableErrorCode !== (result.status === "failed" ? result.stableErrorCode : undefined) || record.workflowTaskId !== result.workflowTaskId)
        throw Error("BLK-TRIGGER-BINDING");
      return record;
    },
  };
}
