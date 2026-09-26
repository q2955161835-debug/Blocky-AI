import { stableId, type Json, type SourceRef } from "@blocky/language-schema";
import { redact } from "./redact";
export type EventType =
  | "run.started"
  | "run.paused"
  | "run.resumed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "block.started"
  | "block.completed"
  | "block.warning"
  | "block.failed"
  | "model.started"
  | "model.chunk"
  | "model.completed"
  | "model.failed"
  | "tool.permission-requested"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "tool.failed"
  | "checkpoint.created"
  | "checkpoint.restored";
export type RuntimeEvent = {
  eventVersion: "blocky.event/v1alpha1";
  projectId: string;
  moduleId?: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: EventType;
  blockId?: string;
  correlationId?: string;
  data: Record<string, Json>;
  redaction: { applied: boolean; categories: string[] };
};
type EventInput = Omit<
  RuntimeEvent,
  "eventVersion" | "sequence" | "timestamp" | "redaction"
>;
let processSequence = 0;
export class EventFactory {
  private active = new Set<string>();
  private completed = new Set<string>();
  constructor(
    private now = () => new Date().toISOString(),
    private nextSequence = () => ++processSequence,
    sequenceFloor = 0,
  ) {
    if (!Number.isSafeInteger(sequenceFloor) || sequenceFloor < 0)
      throw Error("BLK-TYPE-001");
    processSequence = Math.max(processSequence, sequenceFloor);
  }
  create(input: EventInput): RuntimeEvent {
    for (const id of [
      input.projectId,
      input.runId,
      input.moduleId,
      input.blockId,
    ])
      if (id !== undefined && !stableId.test(id)) throw Error("BLK-TYPE-001");
    if (this.completed.has(input.runId)) throw Error("BLK-RUN-002: 运行已结束");
    if (input.type === "run.started") {
      if (this.active.has(input.runId)) throw Error("BLK-RUN-002");
      this.active.add(input.runId);
    } else if (!this.active.has(input.runId))
      throw Error("BLK-RUN-002: 运行未开始");
    const clean = redact(input.data);
    const result: RuntimeEvent = {
      ...input,
      data: clean.value as Record<string, Json>,
      eventVersion: "blocky.event/v1alpha1",
      timestamp: this.now(),
      sequence: this.nextSequence(),
      redaction: clean.redaction,
    };
    if (["run.completed", "run.failed", "run.cancelled"].includes(input.type)) {
      this.active.delete(input.runId);
      this.completed.add(input.runId);
    }
    return result;
  }
}
const visuals = {
  "block.started": {
    state: "active",
    tone: "green",
    outline: "thick",
    icon: "running",
    label: "正在运行",
  },
  "block.completed": {
    state: "idle",
    tone: "neutral",
    outline: "normal",
    icon: "none",
    label: "已完成",
  },
  "block.warning": {
    state: "warning",
    tone: "yellow",
    outline: "thick",
    icon: "warning",
    label: "需要注意",
  },
  "block.failed": {
    state: "error",
    tone: "red",
    outline: "thick",
    icon: "error",
    label: "运行错误",
  },
} as const;
export function projectVisual(event: RuntimeEvent) {
  const v = visuals[event.type as keyof typeof visuals];
  return v && event.blockId ? { blockId: event.blockId, ...v } : undefined;
}
export function projectLog(event: RuntimeEvent) {
  const source: SourceRef = {
    projectId: event.projectId,
    ...(event.moduleId ? { moduleId: event.moduleId } : {}),
    ...(event.blockId ? { blockId: event.blockId } : {}),
  };
  return {
    runId: event.runId,
    eventSequence: event.sequence,
    level: event.type.endsWith("failed")
      ? "error"
      : event.type.endsWith("warning")
        ? "warning"
        : "info",
    summary:
      typeof event.data.summary === "string" ? event.data.summary : event.type,
    source,
    traceTarget: { runId: event.runId, sequence: event.sequence },
  };
}
