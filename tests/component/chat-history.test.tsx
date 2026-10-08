// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useChatHistory } from "../../apps/studio-desktop/src/composition/useChatHistory";
import { writeUserState } from "../../apps/studio-desktop/src/composition/userState";
import { boundedChatMessages } from "../../apps/studio-desktop/src/composition/chatHistory";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
const user = (text: string) => ({
  id: crypto.randomUUID(),
  role: "user" as const,
  text,
});
it("retains the newest reply body and recent calls when thinking exceeds the history budget", () => {
  const retained = boundedChatMessages([
    {
      id: "large-answer",
      role: "assistant",
      text: "😀".repeat(524288),
      thinking: "😀".repeat(524288),
      activity: Array.from({ length: 202 }, (_, index) => ({
        callId: `call-${index}`,
        tool: "blocky_cli" as const,
        status: "completed" as const,
        command: "blocky project validate",
        exitCode: 0,
      })),
    },
  ]);
  expect(retained).toHaveLength(1);
  expect(retained[0].text).toBe("😀".repeat(524288));
  expect(retained[0].activity).toHaveLength(200);
  expect(retained[0].activity?.[0].callId).toBe("call-2");
  expect(retained[0].activityTruncated).toBe(2);
  expect(retained[0].thinkingTruncated).toBe(true);
  expect(
    new TextEncoder().encode(JSON.stringify(retained)).length,
  ).toBeLessThanOrEqual(4 * 1024 * 1024);
});
it("archives the legacy conversation before creating another and restores both after reopening", async () => {
  await writeUserState("coding-chat", "project", {
    schemaVersion: "blocky.coding-chat/v1",
    projectId: "project",
    messages: [user("旧的问题")],
  });
  const hook = renderHook(() => useChatHistory("project", "builder", vi.fn()));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const old = hook.result.current.activeId;
  await act(() => hook.result.current.newChat());
  expect(hook.result.current.activeId).not.toBe(old);
  act(() => hook.result.current.update("project", () => [user("第二个问题")]));
  await act(() => hook.result.current.flush());
  await act(() => hook.result.current.select(old));
  expect(hook.result.current.messages[0].text).toBe("旧的问题");
  hook.unmount();
  const reopened = renderHook(() =>
    useChatHistory("project", "builder", vi.fn()),
  );
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.activeId).toBe(old);
  expect(reopened.result.current.threads.map((t) => t.title)).toEqual(
    expect.arrayContaining(["旧的问题", "第二个问题"]),
  );
});
it("separates project and assistant histories and never executes an old candidate", async () => {
  const hook = renderHook(
    ({
      project,
      assistant,
    }: {
      project: string;
      assistant: "agent" | "builder";
    }) => useChatHistory(project, assistant, vi.fn()),
    { initialProps: { project: "one", assistant: "builder" } },
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() =>
    hook.result.current.update("one", () => [
      { ...user("候选内容"), role: "assistant", status: "proposed" },
    ]),
  );
  await act(() => hook.result.current.flush());
  hook.rerender({ project: "one", assistant: "agent" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.messages).toEqual([]);
  hook.rerender({ project: "two", assistant: "builder" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.messages).toEqual([]);
  hook.rerender({ project: "one", assistant: "builder" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.messages[0].status).toBe("stale");
});
it("keeps the active and archived conversations when new-chat saving fails", async () => {
  const report = vi.fn(),
    hook = renderHook(() => useChatHistory("project", "agent", report));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.update("project", () => [user("仍需保留")]));
  await act(() => hook.result.current.flush());
  const id = hook.result.current.activeId;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("disk-full");
  });
  await act(() => hook.result.current.newChat());
  expect(hook.result.current.activeId).toBe(id);
  expect(hook.result.current.messages[0].text).toBe("仍需保留");
  expect(report).toHaveBeenCalled();
  vi.restoreAllMocks();
  await act(() => hook.result.current.newChat());
  expect(hook.result.current.activeId).not.toBe(id);
});
it("does not replace an unreadable history with an empty new conversation", async () => {
  localStorage.setItem(
    "blocky.chat-history-agent.project",
    JSON.stringify({ schemaVersion: "unknown" }),
  );
  const report = vi.fn(),
    hook = renderHook(() => useChatHistory("project", "agent", report));
  await waitFor(() => expect(report).toHaveBeenCalled());
  expect(hook.result.current.ready).toBe(false);
  await act(() => hook.result.current.newChat());
  expect(
    JSON.parse(localStorage.getItem("blocky.chat-history-agent.project")!)
      .schemaVersion,
  ).toBe("unknown");
});
it("keeps the original searchable title after the bounded transcript rotates", async () => {
  const hook = renderHook(() => useChatHistory("project", "agent", vi.fn()));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() =>
    hook.result.current.update("project", () => [user("最初的会话主题")]),
  );
  act(() =>
    hook.result.current.update("project", (messages) => [
      ...messages,
      ...Array.from({ length: 40 }, (_, i) => user(`后续问题${i}`)),
    ]),
  );
  await act(() => hook.result.current.flush());
  expect(hook.result.current.messages).toHaveLength(40);
  expect(hook.result.current.threads[0].title).toBe("最初的会话主题");
});
