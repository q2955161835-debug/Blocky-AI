// @vitest-environment jsdom
import { createStarter } from "../../packages/test-fixtures/src";
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
  cancelAndDrain: vi.fn(async () => {}),
  resume: vi.fn(),
}));
vi.mock("../../apps/studio-desktop/src/composition/desktop-runtime", () => ({
  DesktopRuntime: class {
    run = calls.run;
    dispose = calls.dispose;
    cancelAndDrain = calls.cancelAndDrain;
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
it("stops before exit without disposing the native facade and can return to run again", async () => {
  const invoke = vi.fn(async (command: string) =>
    command === "read_user_state" ? null : undefined,
  );
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
  vi.stubGlobal("isTauri", true);
  const hook = renderHook(() => useStudio(createStarter()), { wrapper: StrictMode });
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
  expect(calls.cancelAndDrain).toHaveBeenCalledOnce();
  expect(calls.dispose).not.toHaveBeenCalled();
  expect(hook.result.current.exiting).toBe(true);
  await act(() => hook.result.current.flush());
  act(() => hook.result.current.resumeAfterExit());
  expect(hook.result.current.canRun).toBe(true);
  await act(() => hook.result.current.run());
  expect(calls.run).toHaveBeenCalledTimes(2);
});
it("waits for Agent history before F5 can start a native run and refuses an unreadable index", async () => {
  let release!: (value:unknown)=>void;
  const delayed=new Promise(resolve=>{release=resolve;});
  const invoke=vi.fn(async(command:string,args:any)=>command==="read_user_state"?(args.kind==="chat-history-agent"?delayed:null):undefined);
  vi.stubGlobal("__TAURI_INTERNALS__",{invoke});vi.stubGlobal("isTauri",true);
  const hook=renderHook(()=>useStudio(createStarter()));
  await waitFor(()=>expect(hook.result.current.compiling).toBe(false));
  expect(hook.result.current.canRun).toBe(false);
  await act(()=>hook.result.current.run());
  expect(calls.run).not.toHaveBeenCalled();
  await act(async()=>{release(null);await delayed;});
  await waitFor(()=>expect(hook.result.current.canRun).toBe(true));
  hook.unmount();
  const invalidInvoke=vi.fn(async(command:string,args:any)=>command==="read_user_state"?(args.kind==="chat-history-agent"?{schemaVersion:"damaged"}:null):undefined);
  vi.stubGlobal("__TAURI_INTERNALS__",{invoke:invalidInvoke});
  const invalid=renderHook(()=>useStudio(createStarter()));
  await waitFor(()=>expect(invalid.result.current.message).toContain("会话"));
  expect(invalid.result.current.canRun).toBe(false);
  await act(()=>invalid.result.current.run());
  expect(calls.run).not.toHaveBeenCalled();
});
