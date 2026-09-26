import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const fixture = vi.hoisted(() => ({ child: undefined as any }));
vi.mock("node:child_process", () => ({ spawn: () => fixture.child }));
vi.mock("../../tools/blocky-cli/src/native-store", () => ({
  helper: "managed-helper.exe",
}));
import { managedRun } from "../../tools/blocky-cli/src/runtime-managed";
function child() {
  const value = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => false),
    unref: vi.fn(),
  });
  fixture.child = value;
  return value;
}
afterEach(() => {
  vi.useRealTimers();
});
it("fails within the cancellation deadline even when the coordinator never emits close", async () => {
  vi.useFakeTimers();
  const worker = child(),
    abort = new AbortController();
  let outcome = "pending";
  const run = managedRun(["run", "start"], () => {}, abort.signal).then(
    () => {
      outcome = "success";
    },
    (error) => {
      outcome = error.code;
    },
  );
  abort.abort();
  await vi.advanceTimersByTimeAsync(12000);
  expect(outcome).toBe("BLK-RUN-005");
  expect(worker.kill).toHaveBeenCalledOnce();
  await run;
});
it("does not return success until the native supervisor exits after its done receipt", async () => {
  const worker = child();
  let finished = false;
  const run = managedRun(
    ["run", "start"],
    () => {},
    new AbortController().signal,
  ).then((value) => {
    finished = true;
    return value;
  });
  const value = {
    code: 0,
    result: { schemaVersion: "blocky.cli/v1", ok: true },
  };
  worker.stdout.write(JSON.stringify({ kind: "done", value }) + "\n");
  await Promise.resolve();
  expect(finished).toBe(false);
  worker.emit("close", 0);
  expect((await run).code).toBe(0);
});
it("does not expose error-shaped arbitrary native text", async () => {
  const worker = child();
  const run = managedRun(
    ["run", "start"],
    () => {},
    new AbortController().signal,
  );
  const checked = expect(run).rejects.toMatchObject({
    code: "BLK-WORKFLOW-CHANNEL",
  });
  worker.stdout.write(
    JSON.stringify({ kind: "error", code: "BLK-WORKFLOW-PRIVATE-CONTENT" }) +
      "\n",
  );
  worker.emit("close", 3);
  await checked;
});
