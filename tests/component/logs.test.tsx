// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useLogs } from "../../apps/studio-desktop/src/composition/useLogs";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as any).__TAURI_INTERNALS__;
});
it("shows corrupt storage health after policy failure and recovers only on explicit clear", async () => {
  vi.useFakeTimers();
  let corrupt = true;
  const calls: string[] = [];
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (name: string) => {
      calls.push(name);
      if (name === "clear_diagnostics") corrupt = false;
      if (name === "configure_diagnostics" && corrupt)
        throw Error("BLK-LOG-004");
      return {
        effectiveMaxBytes: 10485760,
        storedBytes: 0,
        records: 0,
        maxRecords: 100000,
        health: {
          corruptStore: corrupt,
          quarantinePresent: true,
          quarantinedRecords: 0,
        },
      };
    },
  };
  const studio = {
    session: { outputChannel: "" },
    setSession: vi.fn(),
    settings: { ready: true, layers: {} },
    bus: { subscribe: () => () => {} },
    setMessage: vi.fn(),
  } as unknown as Studio;
  const hook = renderHook(() => useLogs(studio));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(hook.result.current.stats?.health.corruptStore).toBe(true);
  expect(studio.setMessage).toHaveBeenLastCalledWith(
    "诊断存储损坏，请清除本机诊断存储后重试。",
  );
  expect(calls).not.toContain("clear_diagnostics");
  expect(calls).not.toContain("append_diagnostics");
  await act(async () => {
    await hook.result.current.clearStorage();
  });
  expect(hook.result.current.stats?.health.corruptStore).toBe(false);
  expect(studio.setMessage).toHaveBeenLastCalledWith(
    "已清除本机诊断存储，当前视图保留。",
  );
});
it("persists overflow counts after a failed write without exceeding the queue bound", async () => {
  vi.useFakeTimers();
  let receive: (record: any) => void = () => {};
  let fail = true;
  const sent: any[] = [];
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (name: string, args: any) => {
      if (name === "configure_diagnostics")
        return {
          effectiveMaxBytes: 10485760,
          storedBytes: 0,
          records: 0,
          maxRecords: 100000,
          health: {},
        };
      if (fail) throw Error("disk unavailable");
      sent.push({ name, args });
    },
  };
  const studio = {
    session: { outputChannel: "" },
    setSession: vi.fn(),
    settings: { ready: true, layers: {} },
    bus: {
      subscribe: (fn: typeof receive) => {
        receive = fn;
        return () => {};
      },
    },
    setMessage: vi.fn(),
  } as unknown as Studio;
  const hook = renderHook(() => useLogs(studio));
  act(() => {
    for (let i = 1; i <= 1001; i++)
      receive({
        timestamp: "2026-09-16T00:00:00.000Z",
        sequence: i,
        level: i === 1001 ? "error" : "info",
        channel: "runtime",
      });
  });
  await act(async () => {
    await expect(hook.result.current.flush()).rejects.toThrow("BLK-LOG-004");
  });
  fail = false;
  await act(async () => {
    await hook.result.current.flush();
  });
  expect(sent.flatMap((x) => x.args.records)).toHaveLength(1000);
  expect(sent.reduce((sum, x) => sum + x.args.dropped, 0)).toBe(1);
  expect(sent.reduce((sum, x) => sum + x.args.droppedImportant, 0)).toBe(1);
  expect(hook.result.current.queueDroppedImportant).toBe(1);
});
it("uses the same run filter for the current view and native diagnostic export", async () => {
  const sent: { name: string; args: any }[] = [];
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (name: string, args: any) => {
      sent.push({ name, args });
      return name === "export_diagnostics"
        ? true
        : {
            effectiveMaxBytes: 10485760,
            storedBytes: 0,
            records: 0,
            maxRecords: 100000,
            health: {
              corruptStore: false,
              quarantinePresent: false,
              quarantinedRecords: 0,
            },
          };
    },
  };
  const studio = {
    session: { outputChannel: "runtime" },
    setSession: vi.fn(),
    settings: { ready: true, layers: {} },
    bus: { subscribe: () => () => {} },
    setMessage: vi.fn(),
  } as unknown as Studio;
  const hook = renderHook(() => useLogs(studio));
  await act(async () => {
    hook.result.current.setScopeValue("run-a");
  });
  expect(
    hook.result.current.matches({
      channel: "runtime",
      scope: { runId: "run-a" },
    } as any),
  ).toBe(true);
  expect(
    hook.result.current.matches({
      channel: "runtime",
      scope: { runId: "run-b" },
    } as any),
  ).toBe(false);
  await act(async () => {
    await hook.result.current.exportLogs();
  });
  expect(
    sent.find((item) => item.name === "export_diagnostics")?.args,
  ).toMatchObject({ channel: "runtime", scope: { runId: "run-a" } });
});
