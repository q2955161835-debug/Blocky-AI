// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useChatHistory } from "../../apps/studio-desktop/src/composition/useChatHistory";
import { writeUserState } from "../../apps/studio-desktop/src/composition/userState";
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
