import { describe, expect, it } from "vitest";
import {
  createWorkflow,
  parseWorkflow,
  workflowSummary,
  transitionWorkflow,
  advanceWorkflow,
  type WorkflowDefinition,
  type WorkflowRecord,
  type WorkflowStore,
  type WorkflowDriver,
} from "../src/workflow";

const definition: WorkflowDefinition = {
  projectId: "project-owned",
  moduleId: "main",
  blockId: "workflow",
  planDigest: "a".repeat(64),
  runtimeVersion: 1,
  steps: [
    { stepId: "reserve", kind: "action", compensate: true },
    { stepId: "review", kind: "approval", label: "审阅预订" },
    { stepId: "publish", kind: "action", compensate: true },
    { stepId: "saved", kind: "checkpoint" },
  ],
};
class Store implements WorkflowStore {
  record: WorkflowRecord;
  writes: WorkflowRecord[] = [];
  rejectStatus?: string;
  constructor(record = createWorkflow("task-owned", definition, { value: 0 })) {
    this.record = structuredClone(record);
  }
  async read(_taskId: string) {
    return structuredClone(this.record);
  }
  async commit(
    taskId: string,
    action: Parameters<typeof transitionWorkflow>[1],
  ) {
    if (taskId !== this.record.taskId) throw Error("BLK-WORKFLOW-BINDING");
    if (action.revision !== this.record.revision)
      throw Error("BLK-WORKFLOW-CONFLICT");
    const next = transitionWorkflow(this.record, action);
    if (next.status === this.rejectStatus) throw Error("BLK-WORKFLOW-IO");
    this.record = parseWorkflow(next);
    this.writes.push(structuredClone(next));
    return structuredClone(next);
  }
  decide(action: Parameters<typeof transitionWorkflow>[1]) {
    this.record = transitionWorkflow(this.record, action);
  }
}
const idle = () => new AbortController().signal;
const driver = (effects: string[], store: Store): WorkflowDriver => ({
  async execute(step, context) {
    expect(store.record.status).toBe("executing");
    effects.push(context.effectKey);
    return { value: (context.state as { value: number }).value + 1 };
  },
  async compensate(step, context) {
    expect(store.record.status).toBe("undoing");
    effects.push(context.effectKey);
    return context.before;
  },
});

describe("durable workflow boundaries", () => {
  it("does not treat exception text shaped like an error code as trusted public metadata", async () => {
    const store = new Store();
    const failed = await advanceWorkflow(
      store,
      "task-owned",
      definition,
      {
        ...driver([], store),
        async execute() {
          throw Error("BLK-SYNTHETIC-SECRET-123456");
        },
      },
      idle(),
    );
    expect(failed.code).toBe("BLK-WORKFLOW-EFFECT");
    expect(JSON.stringify(workflowSummary(failed))).not.toContain(
      "SYNTHETIC-SECRET",
    );
    expect(() =>
      parseWorkflow({ ...failed, code: "BLK-SYNTHETIC-SECRET-123456" }),
    ).toThrow();
  });
  it("does not dispatch when the intent cannot be saved or its acknowledgement changes", async () => {
    const effects: string[] = [],
      store = new Store();
    store.rejectStatus = "executing";
    await expect(
      advanceWorkflow(
        store,
        "task-owned",
        definition,
        driver(effects, store),
        idle(),
      ),
    ).rejects.toThrow("BLK-WORKFLOW-IO");
    expect(effects).toEqual([]);
    expect(store.record.status).toBe("ready");
    const changed = new Store();
    const commit = changed.commit.bind(changed);
    changed.commit = async (...args) => {
      const result = await commit(...args);
      return { ...result, state: { invented: true } };
    };
    await expect(
      advanceWorkflow(
        changed,
        "task-owned",
        definition,
        driver(effects, changed),
        idle(),
      ),
    ).rejects.toThrow("BLK-WORKFLOW-CONFLICT");
    expect(effects).toEqual([]);
    expect(changed.record.status).toBe("executing");
  });
  it("rejects an invented rollback history and private accessors without invoking them", () => {
    const record = createWorkflow("task-owned", definition, null);
    expect(() =>
      parseWorkflow({
        ...record,
        phase: "rollback",
        status: "compensated",
        cursor: -1,
        receipts: [
          { status: "pending" },
          { status: "approved" },
          { status: "pending" },
          { status: "pending" },
        ],
      }),
    ).toThrow();
    let accessed = false;
    const state = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        accessed = true;
        return "private";
      },
    });
    expect(() => createWorkflow("task-owned", definition, state)).toThrow();
    expect(accessed).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      createWorkflow("task-owned", definition, cyclic as never),
    ).toThrow();
  });
  it("persists intent before effects and resumes from the approved boundary without repeating work", async () => {
    const store = new Store(),
      effects: string[] = [];
    const first = await advanceWorkflow(
      store,
      "task-owned",
      definition,
      driver(effects, store),
      idle(),
    );
    expect(first.status).toBe("awaiting-approval");
    expect(first.cursor).toBe(1);
    expect(effects).toEqual(["task-owned:reserve:forward"]);
    // A separate runner gets only the serialized checkpoint, not closures or a live grant.
    const restarted = new Store(JSON.parse(JSON.stringify(store.record)));
    restarted.decide({
      kind: "decide",
      revision: first.revision,
      stepId: "review",
      decision: "approve",
    });
    const done = await advanceWorkflow(
      restarted,
      "task-owned",
      definition,
      driver(effects, restarted),
      idle(),
    );
    expect(done.status).toBe("completed");
    expect(done.state).toEqual({ value: 2 });
    expect(effects).toEqual([
      "task-owned:reserve:forward",
      "task-owned:publish:forward",
    ]);
    expect(done.receipts.map((receipt) => receipt.status)).toEqual([
      "completed",
      "approved",
      "completed",
      "completed",
    ]);
  });

  it("rejects stale approvals and changed project/plan bindings before any effect", async () => {
    const store = new Store(),
      effects: string[] = [];
    await advanceWorkflow(
      store,
      "task-owned",
      definition,
      driver(effects, store),
      idle(),
    );
    expect(() =>
      transitionWorkflow(store.record, {
        kind: "decide",
        revision: 1,
        stepId: "review",
        decision: "approve",
      }),
    ).toThrow("BLK-WORKFLOW-CONFLICT");
    for (const altered of [
      { ...definition, projectId: "other" },
      { ...definition, planDigest: "b".repeat(64) },
      { ...definition, runtimeVersion: 2 },
    ]) {
      await expect(
        advanceWorkflow(
          store,
          "task-owned",
          altered as WorkflowDefinition,
          driver(effects, store),
          idle(),
        ),
      ).rejects.toThrow("BLK-WORKFLOW-BINDING");
    }
    expect(effects).toHaveLength(1);
  });

  it("does not replay a successful effect whose completion write failed", async () => {
    const store = new Store(),
      effects: string[] = [];
    store.rejectStatus = "ready";
    await expect(
      advanceWorkflow(
        store,
        "task-owned",
        definition,
        driver(effects, store),
        idle(),
      ),
    ).rejects.toThrow("BLK-WORKFLOW-IO");
    expect(store.record.status).toBe("executing");
    expect(effects).toHaveLength(1);
    const restarted = new Store(JSON.parse(JSON.stringify(store.record)));
    await expect(
      advanceWorkflow(
        restarted,
        "task-owned",
        definition,
        driver(effects, restarted),
        idle(),
      ),
    ).rejects.toThrow("BLK-WORKFLOW-UNCERTAIN");
    expect(effects).toHaveLength(1);
    restarted.decide({
      kind: "resolve",
      revision: restarted.record.revision,
      outcome: "completed",
      state: { value: 1 },
    });
    expect(
      (
        await advanceWorkflow(
          restarted,
          "task-owned",
          definition,
          driver(effects, restarted),
          idle(),
        )
      ).status,
    ).toBe("awaiting-approval");
    expect(effects).toHaveLength(1);
  });

  it("compensates completed actions in reverse order and checkpoints every compensation", async () => {
    const plan = {
      ...definition,
      steps: [definition.steps[0], definition.steps[2], definition.steps[1]],
    };
    const store = new Store(createWorkflow("task-owned", plan, { value: 0 })),
      effects: string[] = [];
    const waiting = await advanceWorkflow(
      store,
      "task-owned",
      plan,
      driver(effects, store),
      idle(),
    );
    store.decide({
      kind: "decide",
      revision: waiting.revision,
      stepId: "review",
      decision: "reject",
    });
    const done = await advanceWorkflow(
      store,
      "task-owned",
      plan,
      driver(effects, store),
      idle(),
    );
    expect(done.status).toBe("compensated");
    expect(done.state).toEqual({ value: 0 });
    expect(effects).toEqual([
      "task-owned:reserve:forward",
      "task-owned:publish:forward",
      "task-owned:publish:rollback",
      "task-owned:reserve:rollback",
    ]);
    expect(
      store.writes.filter((write) => write.status === "undoing"),
    ).toHaveLength(2);
  });

  it("does not repeat an uncertain compensation or accept an unrelated manual resolution", async () => {
    const store = new Store(),
      effects: string[] = [];
    const waiting = await advanceWorkflow(
      store,
      "task-owned",
      definition,
      driver(effects, store),
      idle(),
    );
    store.decide({
      kind: "decide",
      revision: waiting.revision,
      stepId: "review",
      decision: "reject",
    });
    const faulty = {
      ...driver(effects, store),
      async compensate() {
        effects.push("rollback-started");
        throw Error("PRIVATE_BODY");
      },
    };
    const failed = await advanceWorkflow(
      store,
      "task-owned",
      definition,
      faulty,
      idle(),
    );
    expect(failed.status).toBe("uncertain");
    expect(failed.code).toBe("BLK-WORKFLOW-EFFECT");
    expect(JSON.stringify(failed)).not.toContain("PRIVATE_BODY");
    await expect(
      advanceWorkflow(store, "task-owned", definition, faulty, idle()),
    ).rejects.toThrow("BLK-WORKFLOW-UNCERTAIN");
    expect(
      effects.filter((value) => value === "rollback-started"),
    ).toHaveLength(1);
    expect(() =>
      transitionWorkflow(failed, {
        kind: "decide",
        revision: failed.revision,
        stepId: "review",
        decision: "approve",
      }),
    ).toThrow();
    store.decide({
      kind: "resolve",
      revision: failed.revision,
      outcome: "completed",
      state: { value: 0 },
    });
    expect(
      (
        await advanceWorkflow(
          store,
          "task-owned",
          definition,
          driver(effects, store),
          idle(),
        )
      ).status,
    ).toBe("compensated");
  });

  it("serializes competing runners before dispatch and pauses before an unstarted effect", async () => {
    const store = new Store(),
      effects: string[] = [];
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        advanceWorkflow(
          store,
          "task-owned",
          definition,
          driver(effects, store),
          idle(),
        ),
      ),
    );
    expect(effects).toHaveLength(1);
    expect(
      outcomes.filter((value) => value.status === "rejected"),
    ).toHaveLength(1);
    const second = new Store(),
      controller = new AbortController();
    controller.abort();
    const paused = await advanceWorkflow(
      second,
      "task-owned",
      definition,
      driver(effects, second),
      controller.signal,
    );
    expect(paused.status).toBe("paused");
    expect(paused.cursor).toBe(0);
    expect(effects).toHaveLength(1);
    expect(() =>
      transitionWorkflow(paused, {
        kind: "decide",
        revision: paused.revision,
        stepId: "review",
        decision: "approve",
      }),
    ).toThrow();
    second.decide({ kind: "resume", revision: paused.revision });
    expect(
      (
        await advanceWorkflow(
          second,
          "task-owned",
          definition,
          driver(effects, second),
          idle(),
        )
      ).status,
    ).toBe("awaiting-approval");
  });

  it("rejects forged state, oversized snapshots, and invalid step definitions", () => {
    const record = createWorkflow("task-owned", definition, { value: 0 });
    for (const changed of [
      { ...record, extra: true },
      { ...record, status: "completed" },
      { ...record, cursor: 20 },
      { ...record, revision: 0 },
      {
        ...record,
        active: { stepId: "reserve", direction: "forward", effectKey: "wrong" },
      },
      { ...record, state: "x".repeat(131073) },
    ])
      expect(() => parseWorkflow(changed)).toThrow();
    expect(() =>
      createWorkflow(
        "task-owned",
        { ...definition, steps: [definition.steps[0], definition.steps[0]] },
        null,
      ),
    ).toThrow();
    expect(() =>
      createWorkflow("task-owned", { ...definition, steps: [] }, null),
    ).toThrow();
    expect(() =>
      createWorkflow(
        "task-owned",
        {
          ...definition,
          steps: [
            {
              stepId: "bad",
              kind: "approval",
              label: "",
              compensate: true,
            } as never,
          ],
        },
        null,
      ),
    ).toThrow();
    expect(() =>
      createWorkflow("task-owned", definition, { number: Infinity }),
    ).toThrow();
  });

  it("projects only metadata without persisted input, results, or compensation bodies", () => {
    const record = createWorkflow("task-owned", definition, {
      input: "PRIVATE_INPUT",
      result: "PRIVATE_RESULT",
    });
    const summary = workflowSummary(record);
    expect(summary.taskId).toBe("task-owned");
    expect(summary.status).toBe("ready");
    expect(JSON.stringify(summary)).not.toMatch(/PRIVATE_|state|before|after/);
  });
});
