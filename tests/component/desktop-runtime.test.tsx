import { expect, it, vi } from "vitest";
import { DesktopRuntime } from "../../apps/studio-desktop/src/composition/desktop-runtime";
import type { RuntimePort } from "../../apps/studio-desktop/src/composition/runtime-port";
import { localAdapters, type RunResult } from "../../packages/runtime-core/src";
import { createStarter } from "../../packages/test-fixtures/src";

const result: RunResult = {
  status: "completed",
  answer: "done",
  citations: [],
  events: [],
  modelApiCalled: false,
};
it("uses native run and waits for service cleanup acknowledgement without transporting private state", async () => {
  const adapters = localAdapters();
  let cleanup!: () => void;
  adapters.agent = {
    close: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          cleanup = resolve;
        }),
    ),
  };
  let receive!: Parameters<RuntimePort["run"]>[3];
  let nativeDone!: (r: RunResult) => void;
  const port: RuntimePort = {
    open: vi.fn(async () => "runtime-owned"),
    close: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    run: vi.fn(async (_s, _r, request, r) => {
      expect(request).not.toHaveProperty("state");
      receive = r;
      return new Promise<RunResult>((resolve) => {
        nativeDone = resolve;
      });
    }),
  };
  const runtime = new DesktopRuntime(() => adapters, port);
  let finished = false;
  const running = runtime
    .run(createStarter(), "on-question", "input", {})
    .then((r) => {
      finished = true;
      return r;
    });
  await vi.waitFor(() => expect(receive).toBeTypeOf("function"));
  receive({ kind: "ready" });
  receive({ kind: "settle" });
  await vi.waitFor(() => expect(cleanup).toBeTypeOf("function"));
  nativeDone(result);
  await Promise.resolve();
  expect(finished).toBe(false);
  cleanup();
  expect(await running).toEqual(result);
  expect(port.send).toHaveBeenCalledWith("runtime-owned", expect.any(String), {
    kind: "settled",
    ok: true,
  });
  await runtime.dispose();
  expect(port.close).toHaveBeenCalledWith("runtime-owned");
});
it("resends cancellation once native registration is ready and keeps failed sessions closed", async () => {
  let receive!: Parameters<RuntimePort["run"]>[3];
  let reject!: (e: unknown) => void;
  const port: RuntimePort = {
    open: async () => "runtime-owned",
    close: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    run: vi.fn(async (_s, _r, _q, r) => {
      receive = r;
      return new Promise<RunResult>((_resolve, no) => {
        reject = no;
      });
    }),
  };
  const runtime = new DesktopRuntime(localAdapters, port),
    abort = new AbortController();
  const run = runtime.run(createStarter(), "on-question", "input", {
    signal: abort.signal,
  });
  const failure = expect(run).rejects.toThrow("BLK-RUN-SERVICE");
  await vi.waitFor(() => expect(receive).toBeTypeOf("function"));
  abort.abort();
  receive({ kind: "ready" });
  await vi.waitFor(() =>
    expect(port.send).toHaveBeenCalledWith(
      "runtime-owned",
      expect.any(String),
      { kind: "cancel" },
    ),
  );
  reject(Error("private failure text"));
  await failure;
  await expect(
    runtime.run(createStarter(), "on-question", "input", {}),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  expect(port.run).toHaveBeenCalledOnce();
  await runtime.dispose();
});

it("does not poison the session when cancelled before native launch", async () => {
  const port: RuntimePort = {
    open: vi.fn(async () => "runtime-owned"),
    close: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    run: vi.fn(async (_s, _r, _q, receive) => {
      receive({ kind: "ready" });
      receive({ kind: "settle" });
      return result;
    }),
  };
  const runtime = new DesktopRuntime(localAdapters, port),
    abort = new AbortController();
  abort.abort();
  await expect(
    runtime.run(createStarter(), "on-question", "input", {
      signal: abort.signal,
    }),
  ).rejects.toThrow("BLK-RUN-SERVICE");
  expect(port.run).not.toHaveBeenCalled();
  expect(
    await runtime.run(createStarter(), "on-question", "input", {}),
  ).toEqual(result);
  await runtime.dispose();
});
