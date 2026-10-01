import { describe, expect, it } from "vitest";
import {
  dueOccurrence, triggerConfigSchema, validateExternalEvent, externalTriggerEventSchema,
  EXTERNAL_TRIGGER_MAX_AGE_MS, EXTERNAL_TRIGGER_FUTURE_SKEW_MS,
  type TriggerConfig, type ExternalTriggerEvent,
} from "../src/triggers";

const fields = { schemaVersion: "blocky.trigger/v1" as const, triggerId: "trigger-one", projectId: "project-one",
  moduleId: "module-one", exportId: "export-one", revision: 1, enabled: true };
function timer(misfire: "skip" | "latest" = "latest"): TriggerConfig {
  return { ...fields, type: "timer", schedule: { kind: "interval", startsAt: 1000, intervalMs: 1000, timeZone: "UTC", misfire } };
}
function external(): TriggerConfig { return { ...fields, type: "external", sourceId: "source-one" }; }
function event(): ExternalTriggerEvent { return { schemaVersion: "blocky.external-trigger-event/v1", eventId: "event-one",
  sourceId: "source-one", projectId: "project-one", triggerId: "trigger-one", revision: 1, occurredAt: 10000, payload: { example: "public" } }; }

describe("pure trigger planning and event validation", () => {
  it("emits deterministic revision-bound occurrences and suppresses repeated points", () => {
    const config = timer();
    const first = dueOccurrence(config, { lastObservedAt: 0 }, 1500)!;
    expect(first).toMatchObject({ scheduledAt: 1000, projectId: "project-one", moduleId: "module-one", exportId: "export-one", revision: 1 });
    expect(dueOccurrence(config, { lastObservedAt: 0 }, 1500)).toEqual(first);
    expect(dueOccurrence(config, { lastObservedAt: 1500, lastOccurrenceId: first.occurrenceId }, 1500)).toBeNull();
    expect(dueOccurrence({ ...config, revision: 2 }, { lastObservedAt: 1500, lastOccurrenceId: first.occurrenceId }, 1500)!.occurrenceId).not.toBe(first.occurrenceId);
    expect(dueOccurrence(config, { lastObservedAt: 0 }, 999)).toBeNull();
  });
  it("latest restart supplies at most the latest missed interval or one-shot", () => {
    expect(dueOccurrence(timer(), { lastObservedAt: 1000 }, 9999)?.scheduledAt).toBe(9000);
    const once = { ...fields, type: "timer", schedule: { kind: "once", startsAt: 1000, timeZone: "+08:00", misfire: "latest" } } as const;
    const first = dueOccurrence(once, { lastObservedAt: 9000 }, 9999)!;
    expect(first.scheduledAt).toBe(1000);
    expect(dueOccurrence(once, { lastObservedAt: 9999, lastOccurrenceId: first.occurrenceId }, 10000)).toBeNull();
  });
  it("skip observes only the inclusive polling window and resets after reconnect", () => {
    const config = timer("skip");
    expect(dueOccurrence(config, { lastObservedAt: 9001 }, 9999)).toBeNull();
    expect(dueOccurrence(config, { lastObservedAt: 8999 }, 9999)?.scheduledAt).toBe(9000);
    expect(dueOccurrence(config, { lastObservedAt: 9000 }, 9999)?.scheduledAt).toBe(9000);
    expect(dueOccurrence(config, { lastObservedAt: 9999 }, 9999)).toBeNull();
    expect(dueOccurrence(config, { lastObservedAt: 9999 }, 10000)?.scheduledAt).toBe(10000);
  });
  it("pause and external configurations never produce timer runs", () => {
    expect(dueOccurrence({ ...timer(), enabled: false }, { lastObservedAt: 0 }, 10000)).toBeNull();
    expect(dueOccurrence(external(), { lastObservedAt: 0 }, 10000)).toBeNull();
    expect(() => dueOccurrence(timer(), { lastObservedAt: 10001 }, 10000)).toThrow("BLK-TRIGGER-CLOCK");
  });
  it("fixed time zones do not shift UTC occurrences; IANA/DST and malformed offsets reject", () => {
    const config = timer();
    if (config.type !== "timer") throw Error("fixture");
    expect(dueOccurrence({ ...config, schedule: { ...config.schedule, timeZone: "+08:00" } }, { lastObservedAt: 0 }, 1500)).toEqual(dueOccurrence(config, { lastObservedAt: 0 }, 1500));
    for (const timeZone of ["Asia/Shanghai", "UTC+8", "+24:00", "-14:01", "+08:60"])
      expect(triggerConfigSchema.safeParse({ ...config, schedule: { ...config.schedule, timeZone } }).success).toBe(false);
    for (const timeZone of ["UTC", "+14:00", "-12:30"])
      expect(triggerConfigSchema.safeParse({ ...config, schedule: { ...config.schedule, timeZone } }).success).toBe(true);
  });
  it("rejects illegal intervals, revisions and mixed configuration fields", () => {
    const config = timer();
    if (config.type !== "timer") throw Error("fixture");
    for (const intervalMs of [0, 999, 1000.5, 31_536_000_001, Infinity])
      expect(triggerConfigSchema.safeParse({ ...config, schedule: { ...config.schedule, intervalMs } }).success).toBe(false);
    expect(triggerConfigSchema.safeParse({ ...config, revision: 0 }).success).toBe(false);
    expect(triggerConfigSchema.safeParse({ ...config, sourceId: "source-one" }).success).toBe(false);
    expect(triggerConfigSchema.safeParse({ ...config, schedule: { ...config.schedule, kind: "once" } }).success).toBe(false);
    expect(triggerConfigSchema.safeParse({ ...external(), token: "synthetic" }).success).toBe(false);
  });
  it("binds external events to current project/source/trigger/revision and target", () => {
    const config = external(); const input = event(); const accepted = validateExternalEvent(config, input, 10000);
    expect(accepted).toMatchObject({ projectId: fields.projectId, moduleId: fields.moduleId, exportId: fields.exportId, sourceId: input.sourceId, eventId: input.eventId, payload: input.payload });
    expect(validateExternalEvent(config, input, 10000).occurrenceId).toBe(accepted.occurrenceId);
    for (const change of [{ projectId: "other-project" }, { triggerId: "other-trigger" }, { sourceId: "other-source" }, { revision: 2 }])
      expect(() => validateExternalEvent(config, { ...input, ...change }, 10000)).toThrow("BLK-TRIGGER-BINDING");
    expect(() => validateExternalEvent({ ...config, enabled: false }, input, 10000)).toThrow("BLK-TRIGGER-DISABLED");
    expect(() => validateExternalEvent({ ...config, revision: 2 }, input, 10000)).toThrow("BLK-TRIGGER-BINDING");
    expect(validateExternalEvent({ ...config, revision: 2 }, { ...input, revision: 2 }, 10000).occurrenceId).not.toBe(accepted.occurrenceId);
  });
  it("enforces external-event age/future bounds and UTF-8 payload bytes", () => {
    const config = external(); const input = event(); const now = 1_000_000;
    expect(() => validateExternalEvent(config, { ...input, occurredAt: now - EXTERNAL_TRIGGER_MAX_AGE_MS }, now)).not.toThrow();
    expect(() => validateExternalEvent(config, { ...input, occurredAt: now - EXTERNAL_TRIGGER_MAX_AGE_MS - 1 }, now)).toThrow("BLK-TRIGGER-EVENT-TIME");
    expect(() => validateExternalEvent(config, { ...input, occurredAt: now + EXTERNAL_TRIGGER_FUTURE_SKEW_MS + 1 }, now)).toThrow("BLK-TRIGGER-EVENT-TIME");
    expect(externalTriggerEventSchema.safeParse({ ...input, payload: "x".repeat(32766) }).success).toBe(true);
    expect(externalTriggerEventSchema.safeParse({ ...input, payload: "x".repeat(32767) }).success).toBe(false);
    expect(externalTriggerEventSchema.safeParse({ ...input, payload: "中".repeat(11000) }).success).toBe(false);
    expect(externalTriggerEventSchema.safeParse({ ...input, authorization: "synthetic" }).success).toBe(false);
  });
});
