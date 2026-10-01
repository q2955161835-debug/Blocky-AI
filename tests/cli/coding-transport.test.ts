import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
import { codingNativeRequest } from "../../tools/blocky-cli/src/coding-transport";
class Pipe extends EventEmitter {
  setEncoding() {}
  resume() {}
  write = vi.fn();
  end = vi.fn();
}
function setup() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new Pipe(),
    stdout: new Pipe(),
    stderr: new Pipe(),
    kill: vi.fn(),
  });
  mocks.spawn.mockReturnValue(child);
  return child;
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("cooperatively cancels and retains failure receipt only after native close", async () => {
  vi.useFakeTimers();
  const child = setup();
  const controller = new AbortController();
  let settled = false;
  const pending = codingNativeRequest(
    "helper",
    { operation: "coding-run" },
    controller.signal,
  ).then((reply) => {
    settled = true;
    return reply;
  });
  controller.abort();
  await vi.advanceTimersByTimeAsync(6000);
  expect(settled).toBe(false);
  expect(child.kill).not.toHaveBeenCalled();
  expect(child.stdin.end).toHaveBeenCalledWith('{"cancel":true}\n');
  const receipt = {
    schemaVersion: "blocky.coding-failure/v1",
    requestId: "task",
    projectId: "sample",
    baseDigest: "a".repeat(64),
    code: "BLK-CODING-CANCELLED",
    changes: [],
    modelApiCalled: false,
  };
  child.stdout.emit(
    "data",
    JSON.stringify({
      schemaVersion: "blocky.project-io/v1alpha1",
      ok: false,
      code: receipt.code,
      value: receipt,
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  child.emit("close", 3);
  expect((await pending).value).toEqual(receipt);
  expect(mocks.spawn.mock.calls[0][1]).toEqual(["--blocky-coding-run"]);
});
it("timeout sends a control frame and waits for settled process exit", async () => {
  vi.useFakeTimers();
  const child = setup();
  let settled = false;
  const pending = codingNativeRequest("helper", {
    operation: "coding-run",
  }).then((reply) => {
    settled = true;
    return reply;
  });
  await vi.advanceTimersByTimeAsync(310000);
  expect(child.stdin.end).toHaveBeenCalledWith('{"cancel":true}\n');
  expect(settled).toBe(false);
  expect(child.kill).not.toHaveBeenCalled();
  child.stdout.emit(
    "data",
    JSON.stringify({
      schemaVersion: "blocky.project-io/v1alpha1",
      ok: false,
      code: "BLK-CODING-TIMEOUT",
    }),
  );
  child.emit("close", 3);
  expect((await pending).ok).toBe(false);
});
it("rejects mismatched success and nonzero native exit", async () => {
  const child = setup();
  const pending = codingNativeRequest("helper", { operation: "coding-run" });
  const failure = expect(pending).rejects.toMatchObject({
    code: "BLK-CODING-SETTLE",
  });
  child.stdout.emit(
    "data",
    JSON.stringify({
      schemaVersion: "blocky.project-io/v1alpha1",
      ok: true,
      value: {},
    }),
  );
  child.emit("close", 3);
  await failure;
});
