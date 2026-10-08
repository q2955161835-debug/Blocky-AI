// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLifecycle } from "../../apps/studio-desktop/src/composition/useLifecycle";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import type { StudioLogs } from "../../apps/studio-desktop/src/composition/useLogs";
import type { StudioTask } from "../../apps/studio-desktop/src/composition/useTask";

const native = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string) => {}),
}));
vi.mock("../../apps/studio-desktop/node_modules/@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: native.invoke,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function setup() {
  const studio = {
    preferences: { minimizeToTray: true },
    settle: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    resumeAfterExit: vi.fn(),
    setMessage: vi.fn(),
  };
  const task = { settle: vi.fn(async () => {}) };
  const builder = { settle: vi.fn(async () => {}) };
  const logs = { flush: vi.fn(async () => {}), clearStorage: vi.fn() };
  const hook = renderHook(() =>
    useLifecycle(
      studio as unknown as Studio,
      logs as unknown as StudioLogs,
      task as unknown as StudioTask,
      builder,
    ),
  );
  return { studio, task, builder, logs, hook };
}

it.each(["studio", "task", "builder", "save", "logs", "native-save"])(
  "restores the workbench after %s fails and really retries without deleting data",
  async (stage) => {
    const s = setup();
    if (stage === "native-save")
      native.invoke
        .mockImplementationOnce(async () => {})
        .mockImplementationOnce(async () => {
          throw "BLK-LOG-004";
        });
    else {
      const method =
        stage === "save"
          ? s.studio.flush
          : stage === "logs"
            ? s.logs.flush
            : s[stage as "studio" | "task" | "builder"].settle;
      method.mockRejectedValueOnce(Error("private path and raw provider data"));
    }
    await act(() => s.hook.result.current.exit());
    expect(s.hook.result.current.error).toBeTruthy();
    expect(s.hook.result.current.error).not.toMatch(/private|provider|清除/);
    expect(s.hook.result.current.canReturn).toBe(true);
    expect(s.studio.resumeAfterExit).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenCalledWith("cancel_exit");
    expect(native.invoke).not.toHaveBeenCalledWith("finish_exit");
    expect(s.logs.clearStorage).not.toHaveBeenCalled();
    await act(() => s.hook.result.current.exit());
    expect(native.invoke).toHaveBeenCalledWith("finish_exit");
  },
);

it("retries only final shutdown after a committed exit fails", async () => {
  native.invoke.mockImplementation(async (command) => {
    if (command === "finish_exit") throw "BLK-EXIT-TERMINAL";
  });
  const s = setup();
  await act(() => s.hook.result.current.exit());
  expect(s.hook.result.current.canReturn).toBe(false);
  expect(s.hook.result.current.error).toContain("BLK-EXIT-TERMINAL");
  expect(s.studio.resumeAfterExit).not.toHaveBeenCalled();
  expect(native.invoke).not.toHaveBeenCalledWith("cancel_exit");
  native.invoke.mockResolvedValue(undefined);
  await act(() => s.hook.result.current.exit());
  expect(s.studio.settle).toHaveBeenCalledOnce();
  expect(s.studio.flush).toHaveBeenCalledOnce();
  expect(
    native.invoke.mock.calls.filter(([name]) => name === "finish_exit"),
  ).toHaveLength(2);
});

it("keeps native recovery failure visible and blocks unsafe return", async () => {
  const s = setup();
  s.studio.settle.mockRejectedValueOnce(Error("BLK-RUN-SERVICE"));
  native.invoke.mockImplementation(async (command) => {
    if (command === "cancel_exit") throw "failure";
  });
  await act(() => s.hook.result.current.exit());
  expect(s.hook.result.current.canReturn).toBe(false);
  expect(s.studio.resumeAfterExit).not.toHaveBeenCalled();
  expect(s.hook.result.current.error).toContain("恢复窗口");
});
