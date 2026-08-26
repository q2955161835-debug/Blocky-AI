import type { RuntimeEvent, RuntimeEventType } from "../core/runtimeEvents";
import type { ModelCallReport } from "../core/deterministicRuntime";
import {
  presentRuntimeEvent,
  type ProgramBlockTypes,
} from "./eventPresentation";

export interface SubmittedRuntimeInput {
  readonly runId: string;
  readonly entryId: string;
  readonly userText: string;
}

export interface PresentedRuntimeEvent {
  readonly label: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly colour: `#${string}`;
}

export interface ConversationTurn {
  readonly runId: string;
  readonly userText: string;
  readonly assistantText: string;
  readonly status: "running" | "completed" | "cancelled" | "failed";
  readonly modelReport: ModelCallReport | null;
  readonly trace: readonly PresentedRuntimeEvent[];
}

const FIXED_EVENT_LABELS: Readonly<Record<RuntimeEventType, string>> = {
  "run.started": "开始处理",
  "run.completed": "处理完成",
  "run.failed": "处理失败",
  "run.cancelled": "已取消",
  "block.started": "进入积木",
  "block.completed": "完成积木",
  "model.chunk": "生成回复",
  "model.completed": "真实模型调用完成",
  "tool.permission_requested": "等待工具授权",
  "tool.started": "调用工具",
  "tool.completed": "工具调用完成",
};

function eventLabel(
  event: RuntimeEvent,
  blockTypes: ProgramBlockTypes,
): string {
  if (event.type === "block.started" || event.type === "block.completed") {
    const presentation = presentRuntimeEvent(event, blockTypes);
    return `${event.type === "block.started" ? "进入" : "完成"} ${presentation.categoryName}`;
  }
  return FIXED_EVENT_LABELS[event.type];
}

function statusFor(events: readonly RuntimeEvent[]): ConversationTurn["status"] {
  const terminal = [...events].reverse().find((event) =>
    event.type === "run.completed" ||
    event.type === "run.cancelled" ||
    event.type === "run.failed",
  );
  if (terminal?.type === "run.completed") return "completed";
  if (terminal?.type === "run.cancelled") return "cancelled";
  if (terminal?.type === "run.failed") return "failed";
  return "running";
}

function assistantTextFor(
  events: readonly RuntimeEvent[],
  status: ConversationTurn["status"],
): string {
  const response = events
    .filter((event) => event.type === "model.chunk")
    .map((event) => event.data.text)
    .filter((text): text is string => typeof text === "string")
    .join("");
  if (response) return response;
  if (status === "failed") return "运行失败，请检查积木后重试。";
  if (status === "cancelled") return "运行已取消，可修改后重试。";
  if (status === "running") return "正在处理…";
  return events.some((event) => event.type === "tool.completed")
    ? "工具调用已完成。"
    : "处理已完成。";
}

function modelReportFor(events: readonly RuntimeEvent[]): ModelCallReport | null {
  const event = [...events].reverse().find((candidate) =>
    candidate.type === "model.completed" && candidate.data.live === true);
  if (!event) return null;
  const { provider, model, requestId, promptTokens, completionTokens, totalTokens } = event.data;
  if (typeof provider !== "string" || typeof model !== "string" ||
    typeof requestId !== "string" || typeof promptTokens !== "number" ||
    typeof completionTokens !== "number" || typeof totalTokens !== "number") return null;
  return {
    live: true,
    provider,
    model,
    requestId,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function projectConversationTurns(
  submissions: readonly SubmittedRuntimeInput[],
  events: readonly RuntimeEvent[],
  blockTypes: ProgramBlockTypes,
): readonly ConversationTurn[] {
  const eventsByRun = new Map<string, RuntimeEvent[]>();
  for (const event of events) {
    const group = eventsByRun.get(event.runId) ?? [];
    group.push(event);
    eventsByRun.set(event.runId, group);
  }

  return submissions.map((submission) => {
    const runEvents = [...(eventsByRun.get(submission.runId) ?? [])]
      .sort((left, right) => left.sequence - right.sequence);
    const status = statusFor(runEvents);
    return {
      runId: submission.runId,
      userText: submission.userText,
      assistantText: assistantTextFor(runEvents, status),
      status,
      modelReport: modelReportFor(runEvents),
      trace: runEvents.map((event) => {
        const presentation = presentRuntimeEvent(event, blockTypes);
        return {
          label: eventLabel(event, blockTypes),
          categoryId: presentation.categoryId,
          categoryName: presentation.categoryName,
          colour: presentation.colour,
        };
      }),
    } satisfies ConversationTurn;
  });
}
