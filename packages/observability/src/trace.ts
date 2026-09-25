import type { RuntimeEvent } from "./events";
import { stableId } from "@blocky/language-schema";

export type TraceFrame = {
  runId: string;
  sequence: number;
  timestamp: string;
  type: RuntimeEvent["type"];
  projectId: string;
  moduleId?: string;
  blockId?: string;
  correlationId?: string;
  summary: string;
  code?: string;
  elapsedMs?: number;
  resultCount?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  redaction: { applied: boolean; categories: string[] };
};

/** A bounded, content-free projection of one run. Replay reads these frames only. */
export class TraceSession {
  private frames: TraceFrame[] = [];
  private runId?: string;
  private lastSequence = -1;
  dropped = 0;
  constructor(private readonly limit = 500) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
      throw Error("BLK-TRACE-001");
  }
  add(event: RuntimeEvent): TraceFrame {
    if (this.runId && this.runId !== event.runId) throw Error("BLK-TRACE-002");
    if (event.sequence <= this.lastSequence) throw Error("BLK-TRACE-002");
    if (!safeTimestamp(event.timestamp)) throw Error("BLK-TRACE-003");
    this.runId = event.runId;
    this.lastSequence = event.sequence;
    const data = event.data;
    const frame: TraceFrame = {
      runId: event.runId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      type: event.type,
      projectId: event.projectId,
      ...(event.moduleId ? { moduleId: event.moduleId } : {}),
      ...(event.blockId ? { blockId: event.blockId } : {}),
      ...(event.correlationId && safeTraceId(event.correlationId) ? { correlationId: event.correlationId } : {}),
      summary: event.type,
      ...(typeof data.code === "string" && /^BLK-[A-Z0-9-]{3,64}$/.test(data.code) ? { code: data.code } : {}),
      ...(typeof data.elapsedMs === "number" && Number.isSafeInteger(data.elapsedMs) && data.elapsedMs >= 0 ? { elapsedMs: data.elapsedMs } : {}),
      ...(typeof data.resultCount === "number" && Number.isSafeInteger(data.resultCount) && data.resultCount >= 0 ? { resultCount: data.resultCount } : {}),
      ...(validUsage(data.usage) ? { usage: data.usage } : {}),
      redaction: { ...event.redaction, categories: [...event.redaction.categories] },
    };
    this.frames.push(frame);
    if (this.frames.length > this.limit) {
      this.frames.shift();
      this.dropped++;
    }
    return frame;
  }
  list(): TraceFrame[] {
    return structuredClone(this.frames);
  }
  at(sequence: number): TraceFrame | undefined {
    const frame = this.frames.find((item) => item.sequence === sequence);
    return frame && structuredClone(frame);
  }
  replay(visit: (frame: TraceFrame) => void): void {
    for (const frame of this.list()) visit(frame);
  }
  export() {
    return {
      schemaVersion: "blocky.trace/v1",
      runId: this.runId ?? null,
      dropped: this.dropped,
      frames: this.list(),
    };
  }
}

/** Read-back of an exported trace. Rebuilds a content-free projection from untrusted JSON. */
export function inspectTraceExport(input: unknown): { runId: string | null; dropped: number; frames: TraceFrame[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("BLK-TRACE-003");
  const trace = input as Record<string, unknown>;
  if (trace.schemaVersion !== "blocky.trace/v1" ||
      (trace.runId !== null && (typeof trace.runId !== "string" || !stableId.test(trace.runId))) ||
      !Number.isSafeInteger(trace.dropped) || Number(trace.dropped) < 0 ||
      !Array.isArray(trace.frames) || trace.frames.length > 10000)
    throw Error("BLK-TRACE-003");
  let last = -1;
  const frames = trace.frames.map((raw: unknown): TraceFrame => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("BLK-TRACE-003");
    const frame = raw as Record<string, unknown>;
    const hasId = (key: string) => typeof frame[key] === "string" && stableId.test(String(frame[key]));
    if (!hasId("runId") || !hasId("projectId") || frame.runId !== trace.runId ||
        !Number.isSafeInteger(frame.sequence) || Number(frame.sequence) <= last ||
        typeof frame.timestamp !== "string" || !safeTimestamp(frame.timestamp) ||
        typeof frame.type !== "string" || !/^(run|block|model|tool|checkpoint)\.[a-z-]+$/.test(frame.type) ||
        frame.summary !== frame.type ||
        (["moduleId", "blockId"].some((key) => frame[key] !== undefined && !hasId(key))) ||
        (frame.correlationId !== undefined && (typeof frame.correlationId !== "string" || !safeTraceId(frame.correlationId))) ||
        !frame.redaction || typeof frame.redaction !== "object" || Array.isArray(frame.redaction))
      throw Error("BLK-TRACE-003");
    last = Number(frame.sequence);
    const redaction = frame.redaction as Record<string, unknown>;
    if (typeof redaction.applied !== "boolean" || !Array.isArray(redaction.categories) ||
        redaction.categories.length > 20 || redaction.categories.some((item) => typeof item !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(item)))
      throw Error("BLK-TRACE-003");
    return {
      runId: String(frame.runId), projectId: String(frame.projectId), sequence: Number(frame.sequence),
      timestamp: String(frame.timestamp), type: frame.type as RuntimeEvent["type"], summary: String(frame.type),
      ...(hasId("moduleId") ? { moduleId: String(frame.moduleId) } : {}),
      ...(hasId("blockId") ? { blockId: String(frame.blockId) } : {}),
      ...(typeof frame.correlationId === "string" ? { correlationId: frame.correlationId } : {}),
      ...(typeof frame.code === "string" && /^BLK-[A-Z0-9-]{3,64}$/.test(frame.code) ? { code: frame.code } : {}),
      ...(Number.isSafeInteger(frame.elapsedMs) && Number(frame.elapsedMs) >= 0 ? { elapsedMs: Number(frame.elapsedMs) } : {}),
      ...(Number.isSafeInteger(frame.resultCount) && Number(frame.resultCount) >= 0 ? { resultCount: Number(frame.resultCount) } : {}),
      ...(validUsage(frame.usage) ? { usage: frame.usage } : {}),
      redaction: { applied: redaction.applied, categories: [...redaction.categories] as string[] },
    };
  });
  if (trace.runId === null && frames.length) throw Error("BLK-TRACE-003");
  return { runId: trace.runId as string | null, dropped: Number(trace.dropped), frames };
}

function validUsage(value: unknown): value is TraceFrame["usage"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return ["inputTokens", "outputTokens", "totalTokens"].every(
    (key) => typeof usage[key] === "number" && Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0,
  ) && Number(usage.totalTokens) === Number(usage.inputTokens) + Number(usage.outputTokens);
}
function safeTraceId(value: string): boolean {
  return value.length <= 160 && stableId.test(value);
}
function safeTimestamp(value: string): boolean {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
