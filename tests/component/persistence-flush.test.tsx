// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSettings } from "../../apps/studio-desktop/src/composition/useSettings";
import { useShortcuts } from "../../apps/studio-desktop/src/composition/useShortcuts";
import { useResources } from "../../apps/studio-desktop/src/composition/useResources";
import { useChatHistory } from "../../apps/studio-desktop/src/composition/useChatHistory";
import { useBuilderChat } from "../../apps/studio-desktop/src/composition/useBuilderChat";
import { ProjectController } from "../../packages/project-model/src";
import { createStarter } from "../../packages/test-fixtures/src";
import { modelResource } from "../fixtures/model-resource";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const message = (text: string) => ({ id: crypto.randomUUID(), role: "user" as const, text });
function failWrites() {
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("disk-full"); });
}
it("drains rolled-back settings and UI failures without replaying the discarded change", async () => {
  const project = createStarter(), controller = new ProjectController(project), report = vi.fn();
  const hook = renderHook(() => useSettings(project, controller, report));
  await waitFor(() => expect(hook.result.current.ready && hook.result.current.ui.ready).toBe(true));
  const original = localStorage.getItem("blocky.settings.app");
  const originalTheme = hook.result.current.ui.values.theme;
  const writes = failWrites();
  act(() => hook.result.current.change("app", "window.minimizeToTray", false));
  act(() => hook.result.current.ui.change("theme", "light"));
  await act(() => hook.result.current.flush());
  expect(report).toHaveBeenCalled();
  expect(hook.result.current.preferences.minimizeToTray).toBe(true);
  expect(hook.result.current.ui.values.theme).toBe(originalTheme);
  expect(localStorage.getItem("blocky.settings.app")).toBe(original);
  const attempts = writes.mock.calls.length;
  await act(() => hook.result.current.flush());
  expect(writes).toHaveBeenCalledTimes(attempts);
});
it("drains a rejected resource mutation without hiding its caller failure or replaying it", async () => {
  const report = vi.fn(), hook = renderHook(() => useResources(report));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const original = hook.result.current.registry;
  const writes = failWrites();
  await act(async () => { await expect(hook.result.current.upsert(modelResource())).rejects.toThrow("disk-full"); });
  await act(() => hook.result.current.flush());
  expect(hook.result.current.registry).toBe(original);
  expect(report).toHaveBeenCalled();
  expect(writes).toHaveBeenCalledTimes(1);
});
it("retries the newest shortcut candidate and keeps exit blocked while storage still fails", async () => {
  const report = vi.fn(), hook = renderHook(() => useShortcuts(report));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const writes = failWrites();
  act(() => hook.result.current.change("file.save", ["Ctrl+Alt+S"]));
  await waitFor(() => expect(report).toHaveBeenCalled());
  act(() => hook.result.current.change("file.save", ["Ctrl+Alt+K"]));
  await act(async () => { await expect(hook.result.current.flush()).rejects.toThrow("disk-full"); });
  writes.mockRestore();
  await act(() => hook.result.current.flush());
  expect(JSON.parse(localStorage.getItem("blocky.shortcuts.app")!).overrides["file.save"]).toEqual(["Ctrl+Alt+K"]);
  hook.unmount();
  const reopened = renderHook(() => useShortcuts(vi.fn()));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.keys("file.save")).toEqual(["Ctrl+Alt+K"]);
});
it("retries the full newest builder transcript in archive-index-compatibility order", async () => {
  const report = vi.fn(), hook = renderHook(() => useChatHistory("project", "builder", report));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const writes = failWrites();
  act(() => hook.result.current.update("project", () => [message("old")]));
  await waitFor(() => expect(report).toHaveBeenCalled());
  act(() => hook.result.current.update("project", () => [{ ...message("latest"), role: "assistant", thinking: "retained thought", status: "cancelled" }]));
  await act(async () => { await expect(hook.result.current.flush()).rejects.toThrow("disk-full"); });
  writes.mockRestore();
  const saved = vi.spyOn(Storage.prototype, "setItem");
  await act(() => hook.result.current.flush());
  expect(saved.mock.calls.map(([key]) => key)).toEqual([
    `blocky.chat-conversation.${hook.result.current.activeId}`,
    "blocky.chat-history-builder.project", "blocky.coding-chat.project",
  ]);
  hook.unmount();
  const reopened = renderHook(() => useChatHistory("project", "builder", vi.fn()));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.messages[0]).toMatchObject({ text: "latest", thinking: "retained thought", status: "cancelled" });
});
it("restores the old active index after a partially persisted failed new-chat selection", async () => {
  const hook = renderHook(() => useChatHistory("project", "agent", vi.fn()));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.update("project", () => [message("keep")]));
  await act(() => hook.result.current.flush());
  const oldId = hook.result.current.activeId, original = Storage.prototype.setItem;
  let indexWrites = 0;
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    original.call(this, key, value);
    if (key === "blocky.chat-history-agent.project" && ++indexWrites === 2) throw Error("late-disk-failure");
  });
  await act(() => hook.result.current.newChat());
  expect(hook.result.current.activeId).toBe(oldId);
  writes.mockRestore();
  await act(() => hook.result.current.flush());
  hook.unmount();
  const reopened = renderHook(() => useChatHistory("project", "agent", vi.fn()));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.activeId).toBe(oldId);
  expect(reopened.result.current.messages[0].text).toBe("keep");
});
it.each(["chat-history-builder", "coding-chat"])("retries every save stage after %s fails, preserving completed tool traces", async (failedKind) => {
  const report = vi.fn(), hook = renderHook(() => useChatHistory("project", "builder", report));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const original = Storage.prototype.setItem;
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === `blocky.${failedKind}.project`) throw Error("disk-full");
    original.call(this, key, value);
  });
  act(() => hook.result.current.update("project", () => [{
    ...message("answer"), role: "assistant", status: "cancelled", thinking: "safe fixture thought",
    activity: [{ callId: "fixture-call", tool: "blocky_cli", command: "patch preview", status: "completed", exitCode: 0 }],
  }]));
  await waitFor(() => expect(report).toHaveBeenCalled());
  await act(async () => { await expect(hook.result.current.flush()).rejects.toThrow("disk-full"); });
  writes.mockRestore();
  const retry = vi.spyOn(Storage.prototype, "setItem");
  await act(() => hook.result.current.flush());
  expect(retry.mock.calls.map(([key]) => key)).toEqual([
    `blocky.chat-conversation.${hook.result.current.activeId}`,
    "blocky.chat-history-builder.project", "blocky.coding-chat.project",
  ]);
  hook.unmount();
  const reopened = renderHook(() => useChatHistory("project", "builder", vi.fn()));
  await waitFor(() => expect(reopened.result.current.ready).toBe(true));
  expect(reopened.result.current.messages[0].activity?.[0]).toMatchObject({ callId: "fixture-call", status: "completed", exitCode: 0 });
});
it("retries legacy builder chat candidates for all affected projects", async () => {
  const report = vi.fn(), hook = renderHook(({ id }) => useBuilderChat(id, report), { initialProps: { id: "one" } });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const writes = failWrites();
  act(() => hook.result.current.update("one", () => [message("first")]));
  await waitFor(() => expect(report).toHaveBeenCalled());
  hook.rerender({ id: "two" });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.update("two", () => [message("second")]));
  await act(async () => { await expect(hook.result.current.flush()).rejects.toThrow("disk-full"); });
  writes.mockRestore();
  await act(() => hook.result.current.flush());
  expect(JSON.parse(localStorage.getItem("blocky.builder-chat.one")!).messages[0].text).toBe("first");
  expect(JSON.parse(localStorage.getItem("blocky.builder-chat.two")!).messages[0].text).toBe("second");
});
