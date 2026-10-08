// @vitest-environment jsdom
import { act, cleanup, render, screen, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createStarter } from "../../packages/test-fixtures/src";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { emptyAgentActivity, recordAgentActivity, agentReplyTrace } from "../../apps/studio-desktop/src/composition/agentActivity";
import { boundedChatMessages } from "../../apps/studio-desktop/src/composition/chatHistory";
import { runtimeActivitySchema } from "../../packages/builder-protocol/src";
import type { RuntimeEvent } from "../../packages/observability/src";
import { AgentTrace } from "../../apps/studio-desktop/src/app/AgentTrace";
const runtime = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../apps/studio-desktop/src/composition/desktop-runtime", () => ({
  DesktopRuntime: class { run = runtime.run; dispose = async () => {}; needsRestart = false; },
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each(["completed", "cancelled", "failed"])("reopens the %s Agent reply with actual thinking and tool outcomes", async (status) => {
  const documents = new Map<string, unknown>();
  const invoke = vi.fn(async (command: string, args: any) => {
    const key = `${args?.kind}:${args?.id}`;
    if (command === "read_user_state") return documents.get(key) ?? null;
    if (command === "write_user_state") documents.set(key, structuredClone(args.value));
  });
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke }); vi.stubGlobal("isTauri", true);
  runtime.run.mockImplementation(async (project, _id, _question, options) => {
    const events = [
      ["tool.started", "call-one", { toolId: "calculator" }],
      ["tool.completed", "call-one", { toolId: "calculator" }],
      ["tool.started", "call-two", { toolId: "calculator" }],
      ["tool.failed", "call-two", { toolId: "calculator", code: "BLK-TOOL-002" }],
    ].map(([type, correlationId, data], index) => ({ eventVersion: "blocky.event/v1alpha1", projectId: project.manifest.projectId,
      runId: "run-real-events", sequence: index + 1, timestamp: "2026-10-09T00:00:00.000Z", type, correlationId, data,
      redaction: { applied: false, categories: [] } }));
    events.forEach(options.onEvent);
    return { status, answer: "已产生的正文", citations: [], events, modelApiCalled: true,
      generations: [{ text: "", toolCalls: [], reasoningContent: "已返回的真实思考", transport: "remote", model: "synthetic-model" }] };
  });
  const hook = renderHook(() => useStudio(createStarter()));
  await waitFor(() => expect(hook.result.current.canRun).toBe(true));
  await act(() => hook.result.current.run());
  const reply = hook.result.current.agentChat.messages.at(-1) as any;
  expect(reply.text).toBe("已产生的正文");
  expect(reply.thinking).toBe("已返回的真实思考");
  expect(reply.runtimeActivity.map((call: any) => call.status)).toEqual(["completed", "failed"]);
  await act(() => hook.result.current.agentChat.flush()); hook.unmount();
  const reopened = renderHook(() => useStudio(createStarter()));
  await waitFor(() => expect(reopened.result.current.agentChat.ready).toBe(true));
  expect(reopened.result.current.agentChat.messages.at(-1)).toEqual(reply);
});
it("keeps actual tool events when native transport fails without inventing returned thinking", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: async (command: string) => command === "read_user_state" ? null : undefined });
  vi.stubGlobal("isTauri", true);
  runtime.run.mockImplementation(async (project, _id, _question, options) => {
    options.onEvent({ eventVersion: "blocky.event/v1alpha1", projectId: project.manifest.projectId, runId: "run-failed",
      type: "tool.started", sequence: 1, timestamp: "2026-10-09T00:00:00.000Z", correlationId: "call-started",
      data: { toolId: "calculator" }, redaction: { applied: false, categories: [] } });
    throw Error("BLK-RUN-SERVICE");
  });
  const hook = renderHook(() => useStudio(createStarter()));
  await waitFor(() => expect(hook.result.current.canRun).toBe(true));
  await act(() => hook.result.current.run());
  const reply = hook.result.current.agentChat.messages.at(-1);
  expect(reply?.status).toBe("failed");
  expect(reply?.runtimeActivity).toEqual([{ callId: "call-started", kind: "tool", toolId: "calculator", status: "started" }]);
  expect(reply?.thinking).toBeUndefined();
});
it("retains newest calls beyond the live event buffer and rejects unsafe arbitrary fields", () => {
  const history = emptyAgentActivity();
  for (let sequence = 1; sequence <= 510; sequence++) recordAgentActivity(history, {
    type: "tool.completed", correlationId: `call-${sequence}`, sequence, data: { toolId: "calculator", arguments: "not archived" },
  } as unknown as RuntimeEvent);
  expect(history.calls).toHaveLength(200); expect(history.removed).toBe(310);
  expect(history.calls[0].callId).toBe("call-311");
  const retained = boundedChatMessages([{ id: "answer", role: "assistant", text: "正文", ...agentReplyTrace(history) }])[0];
  expect(retained.runtimeActivityTruncated).toBe(310);
  expect(JSON.stringify(retained)).not.toContain("arguments");
  expect(runtimeActivitySchema.safeParse({ callId: "call", kind: "tool", status: "failed", code: "raw private error" }).success).toBe(false);
  expect(runtimeActivitySchema.safeParse({ callId: "call", kind: "tool", status: "completed", output: "arbitrary response" }).success).toBe(false);
  render(<AgentTrace message={retained} />);
  expect(screen.getByText(/310 项较早操作已裁剪/)).toBeTruthy();
});
it("ignores events from another project or run instead of attaching them to this reply", () => {
  const history = emptyAgentActivity("own-project");
  const event = { type: "tool.completed", sequence: 1, projectId: "own-project", runId: "own-run", correlationId: "call-one", data: { toolId: "calculator" } } as unknown as RuntimeEvent;
  recordAgentActivity(history, { ...event, projectId: "other-project" });
  expect(history.calls).toEqual([]);
  recordAgentActivity(history, event);
  recordAgentActivity(history, { ...event, runId: "other-run", correlationId: "call-other" });
  expect(history.calls.map(call => call.callId)).toEqual(["call-one"]);
});
