// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { createStartingBlueprint } from "../../packages/block-catalog/src/starting-blueprints";

const native = vi.hoisted(() => ({ invoke: vi.fn(), starter: null as string | null }));
vi.mock("../../apps/studio-desktop/node_modules/@tauri-apps/api/core", () => ({
  isTauri: () => true, invoke: native.invoke,
}));
beforeEach(() => {
  native.starter = null;
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "read_user_state") return null;
    if (command === "startup_project") return native.starter;
    return undefined;
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });

async function openedWork() {
  const hook = renderHook(() => useStudio(createStartingBlueprint("work-assistant")));
  await waitFor(() => expect(hook.result.current.settings.ready && hook.result.current.resources.ready).toBe(true));
  act(() => {
    hook.result.current.setStarted(true);
    hook.result.current.controller.edit(p => { p.manifest.displayName = "原作品的编辑"; });
    hook.result.current.controller.markSaved(hook.result.current.controller.getSnapshot().project);
    hook.result.current.setQuestion("尚未发送的提问");
  });
  return hook;
}

it.each(["blank", "coding-assistant"])("opens %s in another native window without replacing saved project or undo history", async starter => {
  const hook = await openedWork();
  const original = hook.result.current.snapshot;
  await act(async () => {
    if (starter === "blank") await hook.result.current.fresh();
    else await hook.result.current.startBlueprint(starter);
  });
  expect(hook.result.current.snapshot).toBe(original);
  expect(hook.result.current.question).toBe("尚未发送的提问");
  expect(native.invoke).toHaveBeenCalledWith("open_new_window", { starter });
  expect(native.invoke.mock.calls.some(([cmd]) => cmd === "release_project")).toBe(false);
  act(() => hook.result.current.controller.undo());
  expect(hook.result.current.snapshot.project.manifest.displayName).toBe("工作助手");
});

it("preserves an unsaved project and its undo history when new-window launch fails", async () => {
  const hook = await openedWork();
  act(() => hook.result.current.controller.edit(p => { p.manifest.displayName = "尚未保存"; }));
  const original = hook.result.current.snapshot;
  native.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "open_new_window") throw Error("spawn failed");
    return null;
  });
  let completed = false;
  act(() => { void hook.result.current.fresh().then(() => { completed = true; }); });
  await waitFor(() => expect(completed).toBe(true));
  expect(hook.result.current.snapshot).toBe(original);
  expect(hook.result.current.confirmation).toBeNull();
  expect(hook.result.current.message).toContain("新窗口未能打开");
});

it.each(["blank", "work-assistant"])("initializes the requested child %s once after resources are ready, including StrictMode", async starter => {
  native.starter = starter;
  const hook = renderHook(() => useStudio(), { wrapper: StrictMode });
  await waitFor(() => expect(hook.result.current.started).toBe(true));
  const project = hook.result.current.snapshot.project;
  expect(project.manifest.displayName).toBe(starter === "blank" ? "未命名项目" : "工作助手");
  expect(project.workspaces.main.blocks.blocks.length > 0).toBe(starter !== "blank");
  expect(native.invoke.mock.calls.filter(([cmd]) => cmd === "open_new_window")).toEqual([]);
  const revision = hook.result.current.snapshot.revision;
  act(() => hook.rerender());
  expect(hook.result.current.snapshot.revision).toBe(revision);
});
