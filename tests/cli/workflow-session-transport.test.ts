import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createWorkflow,
  transitionWorkflow,
} from "../../packages/runtime-core/src/workflow";
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("../../tools/blocky-cli/src/native-store", () => ({
  helper: "owned-helper",
}));
import { cliWorkflowPorts } from "../../tools/blocky-cli/src/workflow-session";

class Pipe extends EventEmitter {
  setEncoding() {}
  resume() {}
  destroy() {}
  write = vi.fn();
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
async function session() {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new Pipe(),
    stdout: new Pipe(),
    stderr: new Pipe(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("close", 1));
      return true;
    }),
    unref: vi.fn(),
  });
  mock.spawn.mockReturnValue(child);
  const controller = new AbortController();
  const record = createWorkflow(
    "task-test",
    {
      projectId: "project-test",
      moduleId: "main",
      blockId: "flow",
      planDigest: "a".repeat(64),
      runtimeVersion: 1,
      steps: [{ kind: "action", stepId: "effect", compensate: false }],
    },
    null,
  );
  const emit = (type: string, requestId: number, value: unknown) =>
    child.stdout.emit(
      "data",
      JSON.stringify({
        schemaVersion: "blocky.workflow-session/v1",
        type,
        requestId,
        value,
      }) + "\n",
    );
  const opening = cliWorkflowPorts().open(
    { definition: record.definition, initial: null },
    controller.signal,
  );
  emit("ready", 0, record);
  return { child, controller, record, emit, handle: await opening };
}
it("rejects cancelled pending intent promptly, drains its late acknowledgement, then closes in order", async () => {
  const { child, controller, record, emit, handle } = await session();
  let outcome = "pending";
  const begun = handle.store
    .commit(handle.taskId, { kind: "begin", revision: 1 })
    .then(
      () => {
        outcome = "resolved";
      },
      (e) => {
        outcome = e.message;
      },
    );
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toBe("BLK-WORKFLOW-CANCELLED");
  const closing = handle.close();
  expect(child.stdin.write).toHaveBeenCalledTimes(2);
  emit("result", 1, transitionWorkflow(record, { kind: "begin", revision: 1 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(child.stdin.write.mock.lastCall![0])).toMatchObject({
    operation: "close",
    requestId: 2,
  });
  emit("closed", 2, { released: false });
  child.emit("close", 0);
  await closing;
  await begun;
  expect(child.kill).not.toHaveBeenCalled();
});
it("preserves an in-flight completion acknowledgement when cancellation arrives", async () => {
  const { child, controller, record, emit, handle } = await session();
  const begun = handle.store.commit(handle.taskId, {
    kind: "begin",
    revision: 1,
  });
  const executing = transitionWorkflow(record, { kind: "begin", revision: 1 });
  emit("result", 1, executing);
  await begun;
  const complete = handle.store.commit(handle.taskId, {
    kind: "complete",
    revision: 2,
    state: "saved",
  });
  controller.abort();
  await vi.advanceTimersByTimeAsync(1100);
  expect(child.kill).not.toHaveBeenCalled();
  emit(
    "result",
    2,
    transitionWorkflow(executing, {
      kind: "complete",
      revision: 2,
      state: "saved",
    }),
  );
  expect((await complete).state).toBe("saved");
  const closing = handle.close();
  await vi.advanceTimersByTimeAsync(0);
  emit("closed", 3, { released: true });
  child.emit("close", 0);
  await closing;
});
it("bounds missing acknowledgement after cancellation without inventing settlement", async () => {
  const { child, controller, handle } = await session();
  const begun = handle.store
    .commit(handle.taskId, { kind: "begin", revision: 1 })
    .catch((e) => e.message);
  controller.abort();
  const closing = expect(handle.close()).rejects.toThrow(
    "BLK-WORKFLOW-CHANNEL",
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(await begun).toBe("BLK-WORKFLOW-CANCELLED");
  await closing;
  expect(child.kill).toHaveBeenCalledOnce();
  expect(child.stdin.write).toHaveBeenCalledTimes(2);
});
