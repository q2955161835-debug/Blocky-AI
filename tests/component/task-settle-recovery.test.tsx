// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTask } from "../../apps/studio-desktop/src/composition/useTask";
import { createStarter } from "../../packages/test-fixtures/src";
import { createSettings } from "../../packages/settings-core/src";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../apps/studio-desktop/node_modules/@tauri-apps/api/core", () => ({ invoke: native.invoke }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("resumes task status polling when recoverable exit settlement fails", async () => {
  vi.useFakeTimers();
  let resolvePoll!: (value: unknown) => void;
  let rejectSettle!: (error: Error) => void;
  native.invoke.mockImplementation((name: string) => {
    if (name === "start_task") return Promise.resolve("owned-task");
    if (name === "task_status") return new Promise(resolve => { resolvePoll = resolve; });
    if (name === "settle_tasks") return new Promise((_, reject) => { rejectSettle = reject; });
    throw Error("Unexpected fixture command");
  });
  const studio = { busy: false, exiting: false, controller: { getSnapshot: () => ({ project: createStarter() }) }, settings: { layers: { app: createSettings("app") } }, bus: { write: vi.fn() }, setMessage: vi.fn(), setSession: vi.fn() } as any;
  const hook = renderHook(() => useTask(studio));
  await act(() => hook.result.current.start());
  let settlement!: Promise<void>;
  act(() => { settlement = hook.result.current.settle(); });
  await act(async () => { resolvePoll({ requestId: "owned-task", status: "exited", activeProcesses: 0, exitCode: 0 }); });
  await act(async () => { rejectSettle(Error("BLK-WINDOW-001")); await expect(settlement).rejects.toThrow("BLK-WINDOW-001"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(native.invoke.mock.calls.filter(([name]) => name === "task_status").length).toBeGreaterThan(1);
  await act(async () => { resolvePoll({ requestId: "owned-task", status: "exited", activeProcesses: 0, exitCode: 0 }); });
  expect(hook.result.current.active).toBe(false);
  await act(() => hook.result.current.start());
  expect(native.invoke.mock.calls.filter(([name]) => name === "start_task")).toHaveLength(2);
});
