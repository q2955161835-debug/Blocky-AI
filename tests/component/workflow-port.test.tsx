import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ invoke: vi.fn() }));
beforeEach(() =>
  vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: io.invoke } }),
);
import {
  studioWorkflowPorts,
  workflowNative,
} from "../../apps/studio-desktop/src/composition/workflow";
import {
  createWorkflow,
  transitionWorkflow,
  workflowSummary,
} from "../../packages/runtime-core/src/workflow";
const initial = createWorkflow(
  "task-test",
  {
    projectId: "project-test",
    moduleId: "main",
    blockId: "flow",
    planDigest: "a".repeat(64),
    runtimeVersion: 1,
    steps: [{ stepId: "effect", kind: "action", compensate: false }],
  },
  null,
);
const sessionId = "session-11111111-1111-4111-8111-111111111111";
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("uses strict bound reconciliation replies and never returns private checkpoint data", async () => {
  const begun = transitionWorkflow(initial, { kind: "begin", revision: 1 }),
    task = workflowSummary(begun);
  const after = workflowSummary(
    transitionWorkflow(begun, {
      kind: "resolve",
      revision: 2,
      outcome: "not-executed",
    }),
  );
  const preview = {
    applied: false,
    requestDigest: "b".repeat(64),
    task,
    after,
  };
  io.invoke.mockResolvedValue(preview);
  await expect(
    workflowNative.reconcile(task, { outcome: "not-executed" }),
  ).resolves.toEqual(preview);
  expect(io.invoke.mock.calls[0][0]).toBe("workflow_reconcile");
  expect(io.invoke.mock.calls[0][1].request).toMatchObject({
    revision: 2,
    stepId: "effect",
    direction: "forward",
    outcome: "not-executed",
  });
  for (const corrupt of [
    { ...preview, state: "private-canary" },
    { ...preview, task: { ...task, state: "private-canary" } },
    { ...preview, after: { ...after, projectId: "wrong" } },
    { ...preview, after: { ...after, revision: 4 } },
    {
      ...preview,
      after: {
        ...after,
        resolutions: [{ ...after.resolutions[0], direction: "rollback" }],
      },
    },
    {
      ...preview,
      after: {
        ...after,
        resolutions: [{ ...after.resolutions[0], outcome: "completed" }],
      },
    },
    { ...preview, after: { ...after, active: task.active } },
  ]) {
    io.invoke.mockResolvedValue(corrupt);
    await expect(
      workflowNative.reconcile(task, { outcome: "not-executed" }),
    ).rejects.toThrow(/^BLK-WORKFLOW-(INVALID|BINDING)$/);
  }
  io.invoke.mockResolvedValue({
    applied: true,
    requestDigest: "b".repeat(64),
    task: after,
  });
  await expect(
    workflowNative.reconcile(task, { outcome: "not-executed" }, "c".repeat(64)),
  ).rejects.toThrow("BLK-WORKFLOW-BINDING");
});
it("rejects oversized or deeply nested manual state before invoking the Host", async () => {
  const task = workflowSummary(
    transitionWorkflow(initial, { kind: "begin", revision: 1 }),
  );
  for (const state of [
    "x".repeat(131073),
    Array.from({ length: 40 }).reduce<any>((v) => ({ next: v }), null),
  ]) {
    await expect(
      workflowNative.reconcile(task, { outcome: "completed", state }),
    ).rejects.toThrow("BLK-WORKFLOW-LIMIT");
  }
  expect(io.invoke).not.toHaveBeenCalled();
});
it("rejects private fields and other projects in public task lists", async () => {
  for (const task of [
    { ...workflowSummary(initial), state: "private-canary" },
    { ...workflowSummary(initial), projectId: "other" },
  ]) {
    io.invoke.mockResolvedValue([task]);
    await expect(workflowNative.list("project-test")).rejects.toThrow(
      "BLK-WORKFLOW-BINDING",
    );
  }
});

it("bounds an unresponsive open and closes its late native lease without handing it to Runtime", async () => {
  vi.useFakeTimers();
  let ready!: (value: unknown) => void;
  io.invoke.mockImplementation((command: string, { request }: any) =>
    command === "workflow_open"
      ? new Promise((resolve) => {
          ready = resolve;
        })
      : Promise.resolve(
          request.operation === "close" ? { released: true } : null,
        ),
  );
  let outcome = "pending";
  const opening = studioWorkflowPorts()
    .open(
      { definition: initial.definition, initial: null },
      new AbortController().signal,
    )
    .then(
      () => {
        outcome = "opened";
      },
      (e) => {
        outcome = e.message;
      },
    );
  await vi.advanceTimersByTimeAsync(10000);
  expect(outcome).toBe("BLK-WORKFLOW-CHANNEL");
  await opening;
  ready({ sessionId, record: initial });
  await vi.advanceTimersByTimeAsync(0);
  expect(io.invoke.mock.calls.map((c) => c[1].request.operation)).toEqual([
    undefined,
    "cancel",
    "close",
  ]);
  expect(outcome).toBe("BLK-WORKFLOW-CHANNEL");
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels a pending open promptly even when its native result never arrives", async () => {
  vi.useFakeTimers();
  io.invoke.mockImplementation(() => new Promise(() => {}));
  const ctl = new AbortController();
  let outcome = "pending";
  void studioWorkflowPorts()
    .open({ definition: initial.definition, initial: null }, ctl.signal)
    .catch((e) => {
      outcome = e.message;
    });
  ctl.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toBe("BLK-WORKFLOW-CANCELLED");
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a lost begin receipt, rejects further writes, and preserves its unknown intent on close", async () => {
  vi.useFakeTimers();
  let saved = initial;
  io.invoke.mockImplementation(async (command: string, { request }: any) => {
    if (command === "workflow_open") return { sessionId, record: saved };
    if (request.operation === "cancel") return null;
    if (request.operation === "close") return { released: !saved.active };
    if (request.operation === "commit") {
      saved = transitionWorkflow(saved, request.action);
      return new Promise(() => {});
    }
    return saved;
  });
  const handle = await studioWorkflowPorts().open(
    { definition: initial.definition, initial: null },
    new AbortController().signal,
  );
  let outcome = "pending";
  void handle.store
    .commit(handle.taskId, { kind: "begin", revision: 1 })
    .catch((e) => {
      outcome = e.message;
    });
  await vi.advanceTimersByTimeAsync(10000);
  expect(outcome).toBe("BLK-WORKFLOW-CHANNEL");
  await expect(
    handle.store.commit(handle.taskId, {
      kind: "complete",
      revision: 2,
      state: "invented",
    }),
  ).rejects.toThrow("BLK-WORKFLOW-CHANNEL");
  await expect(handle.close()).rejects.toThrow("BLK-WORKFLOW-CHANNEL");
  expect(saved.status).toBe("executing");
  expect(saved.active).toBeDefined();
  expect(
    io.invoke.mock.calls.filter((c) => c[1].request.operation === "commit"),
  ).toHaveLength(1);
  expect(io.invoke.mock.calls.at(-1)![1].request.operation).toBe("close");
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["cancel", "close"])(
  "bounds a lost %s receipt without reporting successful close",
  async (operation) => {
    vi.useFakeTimers();
    io.invoke.mockImplementation(async (command: string, { request }: any) => {
      if (command === "workflow_open") return { sessionId, record: initial };
      if (request.operation === operation) return new Promise(() => {});
      return request.operation === "close" ? { released: true } : null;
    });
    const ctl = new AbortController();
    const handle = await studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      ctl.signal,
    );
    if (operation === "cancel") ctl.abort();
    let outcome = "pending";
    void handle.close().then(
      () => {
        outcome = "closed";
      },
      (e) => {
        outcome = e.message;
      },
    );
    await vi.advanceTimersByTimeAsync(20000);
    expect(outcome).toBe("BLK-WORKFLOW-CHANNEL");
    expect(io.invoke.mock.calls.at(-1)![1].request.operation).toBe("close");
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("bounds task queries and applied approvals whose replies are lost", async () => {
  vi.useFakeTimers();
  io.invoke.mockImplementation(() => new Promise(() => {}));
  let queried = "pending",
    decided = "pending";
  void workflowNative.list("project-test").catch((e) => {
    queried = e.message;
  });
  void workflowNative
    .decide(workflowSummary(initial), "approve", "a".repeat(64))
    .catch((e) => {
      decided = e.message;
    });
  await vi.advanceTimersByTimeAsync(10000);
  expect(queried).toBe("BLK-WORKFLOW-CHANNEL");
  expect(decided).toBe("BLK-WORKFLOW-CHANNEL");
  expect(io.invoke).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not reflect arbitrary native error-shaped text into workflow diagnostics", async () => {
  io.invoke.mockRejectedValue("native failure BLK-WORKFLOW-SECRET-CONTENT");
  await expect(workflowNative.list("project-test")).rejects.toThrow(
    "BLK-WORKFLOW-CHANNEL",
  );
});

it("keeps an aborted begin in the serial slot until its late acknowledgement is drained", async () => {
  vi.useFakeTimers();
  let acknowledge!: (value: unknown) => void;
  const begun = transitionWorkflow(initial, { kind: "begin", revision: 1 });
  io.invoke.mockImplementation((command: string, { request }: any) => {
    if (command === "workflow_open")
      return Promise.resolve({ sessionId, record: initial });
    if (request.operation === "commit")
      return new Promise((resolve) => {
        acknowledge = resolve;
      });
    return Promise.resolve(
      request.operation === "close" ? { released: false } : null,
    );
  });
  const ctl = new AbortController();
  const handle = await studioWorkflowPorts().open(
    { definition: initial.definition, initial: null },
    ctl.signal,
  );
  let outcome = "pending";
  void handle.store
    .commit(handle.taskId, { kind: "begin", revision: 1 })
    .catch((e) => {
      outcome = e.message;
    });
  ctl.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toBe("BLK-WORKFLOW-CANCELLED");
  await expect(
    handle.store.commit(handle.taskId, {
      kind: "uncertain",
      revision: 2,
      code: "BLK-WORKFLOW-CANCELLED",
    }),
  ).rejects.toThrow("BLK-WORKFLOW-CHANNEL");
  const closing = handle.close();
  expect(
    io.invoke.mock.calls.some((c) => c[1].request.operation === "close"),
  ).toBe(false);
  acknowledge(begun);
  await closing;
  expect(
    io.invoke.mock.calls.filter((c) => c[1].request.operation === "commit"),
  ).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["read", "complete"])(
  "bounds a lost %s reply and never revives the failed channel on a late result",
  async (operation) => {
    vi.useFakeTimers();
    let saved = initial,
      acknowledge!: (value: unknown) => void;
    io.invoke.mockImplementation(async (command: string, { request }: any) => {
      if (command === "workflow_open") return { sessionId, record: saved };
      if (request.operation === "cancel") return null;
      if (request.operation === "close") return { released: !saved.active };
      if (request.operation === "commit")
        saved = transitionWorkflow(saved, request.action);
      if (request.operation === operation || request.action?.kind === operation)
        return new Promise((resolve) => {
          acknowledge = resolve;
        });
      return saved;
    });
    const handle = await studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      new AbortController().signal,
    );
    await handle.store.commit(handle.taskId, { kind: "begin", revision: 1 });
    const work =
      operation === "read"
        ? handle.store.read(handle.taskId)
        : handle.store.commit(handle.taskId, {
            kind: "complete",
            revision: 2,
            state: "saved",
          });
    let outcome = "pending";
    void work.catch((e) => {
      outcome = e.message;
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(outcome).toBe("BLK-WORKFLOW-CHANNEL");
    acknowledge(saved);
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.store.read(handle.taskId)).rejects.toThrow(
      "BLK-WORKFLOW-CHANNEL",
    );
    await expect(handle.close()).rejects.toThrow("BLK-WORKFLOW-CHANNEL");
    expect(saved.status).toBe(operation === "read" ? "executing" : "ready");
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("settles a native lease returned after opening was cancelled", async () => {
  let ready!: (value: unknown) => void;
  io.invoke.mockImplementation((command: string, { request }: any) =>
    command === "workflow_open"
      ? new Promise((resolve) => {
          ready = resolve;
        })
      : Promise.resolve(
          request.operation === "close" ? { released: true } : null,
        ),
  );
  const ctl = new AbortController(),
    opening = studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      ctl.signal,
    );
  ctl.abort();
  ready({ sessionId, record: initial });
  await expect(opening).rejects.toThrow();
  expect(io.invoke.mock.calls.map((c) => c[1].request.operation)).toEqual([
    undefined,
    "cancel",
    "close",
  ]);
});
it("blocks new work after cancellation but drains an already completed native receipt before close", async () => {
  let saved = initial,
    acknowledge!: (value: unknown) => void;
  io.invoke.mockImplementation(async (command: string, { request }: any) => {
    if (command === "workflow_open") return { sessionId, record: saved };
    if (request.operation === "cancel") return null;
    if (request.operation === "close") return { released: !saved.active };
    if (request.operation === "commit") {
      saved = transitionWorkflow(saved, request.action);
      if (request.action.kind === "complete")
        return new Promise((resolve) => {
          acknowledge = resolve;
        });
    }
    return saved;
  });
  const ctl = new AbortController(),
    handle = await studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      ctl.signal,
    );
  await handle.store.commit(handle.taskId, { kind: "begin", revision: 1 });
  const done = handle.store.commit(handle.taskId, {
    kind: "complete",
    revision: 2,
    state: "saved",
  });
  ctl.abort();
  await expect(handle.store.read(handle.taskId)).rejects.toThrow(
    "BLK-WORKFLOW-CANCELLED",
  );
  const closing = handle.close();
  expect(
    io.invoke.mock.calls.some((c) => c[1].request.operation === "close"),
  ).toBe(false);
  acknowledge(saved);
  expect((await done).state).toBe("saved");
  await closing;
  expect(io.invoke.mock.calls.at(-1)![1].request.operation).toBe("close");
});
it("closes and rejects a record for a different definition", async () => {
  io.invoke
    .mockResolvedValueOnce({
      sessionId,
      record: {
        ...initial,
        definition: { ...initial.definition, projectId: "other" },
      },
    })
    .mockResolvedValueOnce({ released: true });
  await expect(
    studioWorkflowPorts().open(
      { definition: initial.definition, initial: null },
      new AbortController().signal,
    ),
  ).rejects.toThrow("BLK-WORKFLOW-BINDING");
  expect(io.invoke.mock.calls.at(-1)![1].request.operation).toBe("close");
});
