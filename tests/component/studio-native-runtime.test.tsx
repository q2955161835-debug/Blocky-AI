// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { StrictMode } from "react";
const calls = vi.hoisted(() => ({
  run: vi.fn(async () => ({
    status: "completed",
    answer: "native",
    citations: [],
    events: [],
    modelApiCalled: false,
  })),
  dispose: vi.fn(async () => {}),
  resume: vi.fn(),
}));
vi.mock("../../apps/studio-desktop/src/composition/desktop-runtime", () => ({
  DesktopRuntime: class {
    run = calls.run;
    dispose = calls.dispose;
    resume = calls.resume;
    pause = vi.fn();
    step = vi.fn();
    needsRestart = false;
  },
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("routes the Studio entry through the native facade and disposes it during exit", async () => {
  const invoke = vi.fn(async (command: string) =>
    command === "read_user_state" ? null : undefined,
  );
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
  vi.stubGlobal("isTauri", true);
  const hook = renderHook(() => useStudio(), { wrapper: StrictMode });
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  expect(hook.result.current.compiled?.diagnostics).toEqual([]);
  expect(hook.result.current.canRun).toBe(true);
  expect(calls.dispose).not.toHaveBeenCalled();
  await act(() => hook.result.current.run());
  expect(
    invoke.mock.calls.some(([command]) => command === "authorize_run"),
  ).toBe(true);
  expect(hook.result.current.result?.answer).toBe("native");
  expect(calls.run, hook.result.current.message).toHaveBeenCalledOnce();
  expect(hook.result.current.result?.answer).toBe("native");
  await act(() => hook.result.current.settle());
  expect(calls.dispose).toHaveBeenCalledOnce();
});
