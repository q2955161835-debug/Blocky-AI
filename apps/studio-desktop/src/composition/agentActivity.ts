import { codingTextBytePrefix, runtimeActivitySchema, type RuntimeActivity } from "@blocky/builder-protocol";
import { containsCredential } from "@blocky/language-schema";
import type { RuntimeEvent } from "@blocky/observability";
import type { RunResult } from "@blocky/runtime-core";
import { codingActivityLimit } from "./codingActivity";
export type AgentActivity = { calls: RuntimeActivity[]; removed: number; projectId?: string; runId?: string };
export const emptyAgentActivity = (projectId?: string): AgentActivity => ({ calls: [], removed: 0, projectId });
export function recordAgentActivity(history: AgentActivity, event: RuntimeEvent): void {
  if (history.projectId && event.projectId !== history.projectId) return;
  if (history.runId && event.runId !== history.runId) return;
  if (event.runId) history.runId ??= event.runId;
  const match = /^(model|tool)\.(started|completed|failed)$/.exec(event.type);
  if (!match) return;
  const kind = match[1] as "model" | "tool";
  const stem = `${kind}-${event.moduleId ?? "run"}-${event.blockId ?? "call"}`;
  const previous = event.correlationId
    ? history.calls.find(call => call.callId === event.correlationId)
    : [...history.calls].reverse().find(call => call.kind === kind && call.callId.startsWith(`${stem}-`) && call.status === "started");
  const raw = { ...previous, callId: event.correlationId ?? previous?.callId ?? `${stem}-${event.sequence}`, kind,
    status: event.data.code === "BLK-RUN-005" ? "cancelled" : match[2],
    ...(typeof event.data.toolId === "string" ? { toolId: event.data.toolId } : {}),
    ...(typeof event.data.operation === "string" ? { operation: event.data.operation } : {}),
    ...(typeof event.data.code === "string" ? { code: event.data.code } : {}),
  };
  const parsed = runtimeActivitySchema.safeParse(raw);
  if (!parsed.success) return;
  history.calls = previous ? history.calls.map(call => call === previous ? parsed.data : call) : [...history.calls, parsed.data];
  const removed = Math.max(0, history.calls.length - codingActivityLimit);
  history.calls = history.calls.slice(-codingActivityLimit);
  history.removed = Math.min(65536, history.removed + removed);
}
/** Generations are actual returned responses; Runtime events contain no text/thinking deltas. */
export function agentReplyTrace(history: AgentActivity, result?: RunResult) {
  let thinking = "", thinkingTruncated = false;
  for (const generation of result?.generations ?? []) {
    const text = generation.reasoningContent;
    if (!text) continue;
    if (containsCredential(text)) { thinkingTruncated = true; continue; }
    const joined = thinking ? `${thinking}\n\n${text}` : text;
    thinking = codingTextBytePrefix(joined, 2 * 1024 * 1024);
    if (thinking !== joined) thinkingTruncated = true;
  }
  return { ...(history.calls.length ? { runtimeActivity: history.calls } : {}),
    ...(history.removed ? { runtimeActivityTruncated: history.removed } : {}),
    ...(thinking ? { thinking } : {}), ...(thinkingTruncated ? { thinkingTruncated } : {}) };
}
