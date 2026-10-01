import { stableId, type Json } from "@blocky/language-schema";
import { z } from "zod";

const identity = z.string().max(128).regex(stableId);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const epoch = z.number().int().nonnegative().max(8_640_000_000_000_000);
const timeZone = z.string().refine((value) => {
  if (value === "UTC") return true;
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return hours <= 14 && minutes <= 59 && (hours < 14 || minutes === 0);
}, "Only UTC or a bounded fixed UTC offset is supported");
const scheduleFields = {
  startsAt: epoch,
  timeZone,
  misfire: z.enum(["skip", "latest"]),
};
export const triggerScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), ...scheduleFields }).strict(),
  z.object({
    kind: z.literal("interval"),
    ...scheduleFields,
    intervalMs: z.number().int().min(1000).max(31_536_000_000),
  }).strict(),
]);
const triggerFields = {
  schemaVersion: z.literal("blocky.trigger/v1"),
  triggerId: identity,
  projectId: identity,
  moduleId: identity,
  exportId: identity,
  revision,
  enabled: z.boolean(),
};
export const triggerConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("timer"), ...triggerFields, schedule: triggerScheduleSchema }).strict(),
  z.object({ type: z.literal("external"), ...triggerFields, sourceId: identity }).strict(),
]);
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export const triggerObservationSchema = z.object({
  lastObservedAt: epoch,
  lastOccurrenceId: z.string().min(1).max(512).optional(),
}).strict();
export type TriggerObservation = z.infer<typeof triggerObservationSchema>;

export interface TriggerOccurrence {
  occurrenceId: string;
  projectId: string;
  triggerId: string;
  revision: number;
  moduleId: string;
  exportId: string;
  scheduledAt: number;
}
function checked<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch { /* Invalid recursive input also fails closed. */ }
  throw Error(code);
}
function occurrence(config: TriggerConfig, suffix: string, scheduledAt: number): TriggerOccurrence {
  return {
    occurrenceId: `${config.projectId}:${config.triggerId}:r${config.revision}:${suffix}`,
    projectId: config.projectId,
    triggerId: config.triggerId,
    revision: config.revision,
    moduleId: config.moduleId,
    exportId: config.exportId,
    scheduledAt,
  };
}

/** Pure planner: no clock, permissions, persistence or module execution lives here.
 * Fixed offset timeZone is presentation metadata: startsAt is always UTC epoch ms.
 * Host persists/reserves occurrenceId using CAS before dispatching an authorized run.
 * Reconnecting skip callers reset lastObservedAt=now; latest callers keep history.
 */
export function dueOccurrence(
  input: TriggerConfig,
  observed: TriggerObservation,
  timestamp: number,
): TriggerOccurrence | null {
  const config = checked(triggerConfigSchema, input, "BLK-TRIGGER-CONFIG");
  const state = checked(triggerObservationSchema, observed, "BLK-TRIGGER-OBSERVATION");
  const now = checked(epoch, timestamp, "BLK-TRIGGER-CLOCK");
  if (state.lastObservedAt > now) throw Error("BLK-TRIGGER-CLOCK");
  if (!config.enabled || config.type !== "timer" || now < config.schedule.startsAt) return null;
  const { schedule } = config;
  const slot = schedule.kind === "once" ? 0 : Math.floor((now - schedule.startsAt) / schedule.intervalMs);
  const scheduledAt = schedule.startsAt + (schedule.kind === "once" ? 0 : slot * schedule.intervalMs);
  if (schedule.misfire === "skip" && scheduledAt < state.lastObservedAt) return null;
  const result = occurrence(config, `timer:${scheduledAt}`, scheduledAt);
  return state.lastOccurrenceId === result.occurrenceId ? null : result;
}

export const EXTERNAL_TRIGGER_PAYLOAD_LIMIT = 32 * 1024;
export const EXTERNAL_TRIGGER_MAX_AGE_MS = 5 * 60 * 1000;
export const EXTERNAL_TRIGGER_FUTURE_SKEW_MS = 30 * 1000;
const payload = z.json().refine((value) => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= EXTERNAL_TRIGGER_PAYLOAD_LIMIT; }
  catch { return false; }
}, "External trigger payload exceeds the UTF-8 byte limit");
export const externalTriggerEventSchema = z.object({
  schemaVersion: z.literal("blocky.external-trigger-event/v1"),
  eventId: identity,
  sourceId: identity,
  projectId: identity,
  triggerId: identity,
  revision,
  occurredAt: epoch,
  payload,
}).strict();
export type ExternalTriggerEvent = z.infer<typeof externalTriggerEventSchema>;
export interface ExternalTriggerOccurrence extends TriggerOccurrence {
  eventId: string;
  sourceId: string;
  payload: Json;
}

/** Validate an already authenticated event against the current binding. This neither
 * authenticates the sender nor grants run authority. Host owns durable event-id CAS.
 * A paused binding rejects the event; stale revision/project/source never dispatches.
 */
export function validateExternalEvent(
  input: TriggerConfig,
  inputEvent: ExternalTriggerEvent,
  timestamp: number,
): ExternalTriggerOccurrence {
  const config = checked(triggerConfigSchema, input, "BLK-TRIGGER-CONFIG");
  const event = checked(externalTriggerEventSchema, inputEvent, "BLK-TRIGGER-EVENT");
  const now = checked(epoch, timestamp, "BLK-TRIGGER-CLOCK");
  if (config.type !== "external" || !config.enabled) throw Error("BLK-TRIGGER-DISABLED");
  if (config.projectId !== event.projectId || config.triggerId !== event.triggerId || config.revision !== event.revision
    || config.sourceId !== event.sourceId) throw Error("BLK-TRIGGER-BINDING");
  if (event.occurredAt < now - EXTERNAL_TRIGGER_MAX_AGE_MS || event.occurredAt > now + EXTERNAL_TRIGGER_FUTURE_SKEW_MS)
    throw Error("BLK-TRIGGER-EVENT-TIME");
  return {
    ...occurrence(config, `external:${event.eventId}`, event.occurredAt),
    eventId: event.eventId,
    sourceId: event.sourceId,
    payload: event.payload,
  };
}
