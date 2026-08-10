import { canonicalizeJson, type JsonValue } from "./json";
import { redactSensitiveValues } from "./securityScan";

export const RUNTIME_EVENT_TYPES = Object.freeze([
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "block.started",
  "block.completed",
  "model.chunk",
  "tool.permission_requested",
  "tool.started",
  "tool.completed",
] as const);

export type RuntimeEventType = typeof RUNTIME_EVENT_TYPES[number];

/** The frozen, canonical, redacted event contract shared by every Core runtime consumer. */
export interface RuntimeEvent {
  readonly eventVersion: "blocky.event/v0-spike";
  readonly runId: string;
  readonly sequence: number;
  readonly type: RuntimeEventType;
  readonly blockId?: string;
  readonly data: Record<string, JsonValue>;
}

export interface RuntimeEventInput {
  runId: string;
  sequence: number;
  type: RuntimeEventType;
  blockId?: string;
  data?: Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  return Object.freeze(value);
}

/** The only supported runtime-event construction path. */
export function createRuntimeEvent(input: RuntimeEventInput): RuntimeEvent {
  const data = redactSensitiveValues(input.data ?? {});
  if (data === null || Array.isArray(data) || typeof data !== "object") {
    throw new TypeError("RUNTIME_EVENT_DATA_NOT_OBJECT");
  }
  const raw: RuntimeEvent = {
    ...(input.blockId === undefined ? {} : { blockId: input.blockId }),
    data: data as Record<string, JsonValue>,
    eventVersion: "blocky.event/v0-spike",
    runId: input.runId,
    sequence: input.sequence,
    type: input.type,
  };
  const event = canonicalizeJson(raw) as unknown as RuntimeEvent;
  return deepFreeze(event);
}
