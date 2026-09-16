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
