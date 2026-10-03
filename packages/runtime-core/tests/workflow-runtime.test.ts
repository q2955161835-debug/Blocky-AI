import { expect, it } from "vitest";
import { createArchitectureStarter } from "../../test-fixtures/src/scenarios";
import { compileProject } from "@blocky/compiler";
import { canonicalJson, type WorkspaceBlock } from "@blocky/language-schema";
import { Runtime } from "../src/runtime";
import { localAdapters } from "../src/adapters";
import {
  createWorkflow,
  transitionWorkflow,
  assertWorkflowBinding,
  type WorkflowRecord,
} from "../src/workflow";
import type { WorkflowPorts } from "../src/workflow/runtime";

const block = (
  id: string,
  type: string,
  fields: Record<string, string> = {},
  inputs: Record<string, { block: WorkspaceBlock }> = {},
): WorkspaceBlock => ({ id, type, fields, inputs });
const stack = (...nodes: WorkspaceBlock[]) => {
  for (let i = 0; i < nodes.length - 1; i++)
    nodes[i].next = { block: nodes[i + 1] };
  return nodes[0];
};
function project() {
  const p = createArchitectureStarter("event-mailbox");
  p.schemas["schemas/workflow-output.json"] = {
    type: "object",
    properties: { saved: { type: "boolean" } },
    required: ["saved"],
    additionalProperties: false,
  };
  const first = block(
    "first",
    "runtime.compensate",
    {},
    {
      DO: {
        block: stack(
          block("set", "core.data.set", { VALUE: '{"saved":true}' }),
          block("remember", "core.memory.write", {
            SCOPE: "session",
            KEY: "progress",
            SOURCE: "result",
          }),
          block("send", "core.event.send", {
            CHANNEL: "jobs",
            SOURCE: "result",
          }),
          block("instruction", "core.prompt.context", {
            TEXT: "private-instruction",
          }),
        ),
      },
      UNDO: {
        block: block("undo", "core.data.set", { VALUE: '{"saved":false}' }),
      },
    },
  );
  const approval = block("approve", "core.human.approve", {
    LABEL: "Review progress",
  });
  const second = block(
    "second",
    "runtime.compensate",
    {},
    {
      DO: {
        block: stack(
          block("receive", "core.event.receive", {
            CHANNEL: "jobs",
            TIMEOUT_MS: "0",
          }),
          block("recall", "core.memory.read", {
            SCOPE: "session",
            KEY: "progress",
          }),
          block("output", "core.output.structured", {
            SCHEMA: "schemas/workflow-output.json",
          }),
        ),
      },
    },
  );
  p.workspaces.main.blocks.blocks[0].inputs!.HANDLER = {
    block: block(
      "workflow",
      "runtime.task.durable",
      {},
      {
        STEPS: {
          block: stack(
            first,
            approval,
            second,
            block("checkpoint", "runtime.checkpoint.save"),
          ),
        },
      },
    ),
  };
  return p;
}
function fixture() {
  let record: WorkflowRecord | undefined;
  let opens = 0;
  const ports: WorkflowPorts = {
    open: async (request) => {
      opens++;
      if (request.taskId) {
        if (!record) throw Error("BLK-WORKFLOW-NOT-FOUND");
        assertWorkflowBinding(record, request.taskId, request.definition);
      } else
        record = createWorkflow(
          "task-owned",
          request.definition,
          request.initial,
        );
      return {
        taskId: "task-owned",
        store: {
          read: async () => structuredClone(record!),
          commit: async (_, action) => {
            record = transitionWorkflow(record!, action);
            return structuredClone(record);
          },
        },
        close: async () => {},
      };
    },
  };
  return {
    ports,
    get record() {
      return record!;
    },
    get opens() {
      return opens;
    },
    decide(decision: "approve" | "reject") {
      record = transitionWorkflow(record!, {
        kind: "decide",
        revision: record!.revision,
        stepId: "approve",
        decision,
      });
    },
  };
}
it("rejecting the official workflow clears its prepared input and never delivers it", async () => {
  const p = createArchitectureStarter("durable-workflow"),
    f = fixture();
  const adapters = { ...localAdapters(), workflow: f.ports };
  const waiting = await new Runtime({ adapters }).run(
    p,
    "on-event",
    "private-prepared-input",
  );
  expect(waiting.status).toBe("waiting");
  expect(f.record.state).toMatchObject({
    agent: {
      sessionMemory: [{ key: "saved-input", value: "private-prepared-input" }],
    },
  });
  f.decide("reject");
  const result = await new Runtime({ adapters }).run(
    p,
    "on-event",
    "replacement-input",
    { workflowTaskId: "task-owned" },
  );
  expect(result.workflow?.status).toBe("compensated");
  expect(result.structured).toBe("compensated");
  expect(f.record.state).toMatchObject({ agent: { sessionMemory: [] } });
  expect(result.events.some((e) => e.blockId === "deliver")).toBe(false);
});
it("runs existing child stacks to a durable approval and resumes a new Runtime with complete private context", async () => {
  const p = project(),
    f = fixture();
  expect(
    (await compileProject(p)).diagnostics.filter((d) => d.severity === "error"),
  ).toEqual([]);
  const adapters = { ...localAdapters(), workflow: f.ports };
  const paused = await new Runtime({ adapters }).run(
    p,
    "on-event",
    "original-private-input",
  );
  expect(paused.status).toBe("waiting");
  expect(paused.workflow?.status).toBe("awaiting-approval");
  expect(
    paused.events.some(
      (e) => e.type === "run.completed" || e.type === "run.failed",
    ),
  ).toBe(false);
  expect(canonicalJson(paused.events)).not.toContain("original-private-input");
  f.decide("approve");
  const resumed = await new Runtime({ adapters }).run(
    p,
    "on-event",
    "different-input",
    { workflowTaskId: "task-owned" },
  );
  expect(resumed.status).toBe("completed");
  expect(resumed.structured).toEqual({ saved: true });
  expect(resumed.modelApiCalled).toBe(false);
  expect(resumed.events.some((e) => e.blockId === "first")).toBe(false);
  expect(f.record.state).toMatchObject({
    agent: {
      question: "original-private-input",
      instruction: "\nprivate-instruction",
      events: [],
    },
  });
});
it("rejects changed semantics before replay and runs declared compensation only after rejection", async () => {
  const p = project(),
    f = fixture(),
    adapters = { ...localAdapters(), workflow: f.ports };
  await new Runtime({ adapters }).run(p, "on-event", "input");
  const changed = structuredClone(p);
  changed.schemas["schemas/changed.json"] = { type: "string" };
  const failed = await new Runtime({ adapters }).run(
    changed,
    "on-event",
    "input",
    { workflowTaskId: "task-owned" },
  );
  expect(failed.status).toBe("failed");
  expect(failed.events.find((e) => e.type === "run.failed")?.data.code).toBe(
    "BLK-WORKFLOW-BINDING",
  );
  expect(f.record.status).toBe("awaiting-approval");
  f.decide("reject");
  const result = await new Runtime({ adapters }).run(p, "on-event", "input", {
    workflowTaskId: "task-owned",
  });
  expect(result.status).toBe("completed");
  expect(result.workflow?.status).toBe("compensated");
  expect(
    result.events.some(
      (e) => e.blockId === "undo" && e.type === "block.completed",
    ),
  ).toBe(true);
  expect(result.events.some((e) => e.blockId === "second")).toBe(false);
});
it("requires a Host port and rejects detached or nested workflow markers before running", async () => {
  const p = project();
  const result = await new Runtime().run(p, "on-event", "input");
  expect(result.status).toBe("failed");
  expect(result.events.find((e) => e.type === "run.failed")?.data.code).toBe(
    "BLK-WORKFLOW-PORT",
  );
  p.workspaces.main.blocks.blocks[0].inputs!.HANDLER = {
    block: block("detached", "core.human.approve", { LABEL: "Review" }),
  };
  expect(
    (await compileProject(p)).diagnostics.some(
      (d) => d.code === "BLK-WORKFLOW-SCOPE",
    ),
  ).toBe(true);
});
it("rejects recovery through an ordinary entry before executing any ordinary block", async () => {
  const p = createArchitectureStarter("event-mailbox"),
    f = fixture();
  const result = await new Runtime({
    adapters: { ...localAdapters(), workflow: f.ports },
  }).run(p, "on-event", "private-new-event", {
    workflowTaskId: "task-missing",
  });
  expect(result.status).toBe("failed");
  expect(result.events.some((e) => e.type === "block.started")).toBe(false);
  expect(f.opens).toBe(0);
});
it("rejects work before a workflow root and nested workflow roots at compile time", async () => {
  const p = project();
  const entry = p.workspaces.main.blocks.blocks[0];
  entry.inputs!.HANDLER = {
    block: stack(
      block("before", "core.event.send", {
        CHANNEL: "outside",
        SOURCE: "input",
      }),
      entry.inputs!.HANDLER!.block!,
    ),
  };
  expect(
    (await compileProject(p)).diagnostics.some(
      (d) => d.code === "BLK-WORKFLOW-SCOPE",
    ),
  ).toBe(true);
  const nested = project(),
    root = nested.workspaces.main.blocks.blocks[0].inputs!.HANDLER!.block!;
  root.inputs!.STEPS!.block!.inputs!.DO = { block: structuredClone(root) };
  expect(
    (await compileProject(nested)).diagnostics.some(
      (d) => d.code === "BLK-WORKFLOW-SCOPE",
    ),
  ).toBe(true);
});
it("does not publish or execute a Host acknowledgement with a different workflow binding", async () => {
  const p = project(),
    f = fixture(),
    open = f.ports.open;
  f.ports.open = async (request, signal) => {
    const handle = await open(request, signal);
    const commit = handle.store.commit;
    handle.store.commit = async (id, action) => {
      const record = await commit(id, action);
      record.definition.moduleId = "foreign-module";
      return record;
    };
    return handle;
  };
  const result = await new Runtime({
    adapters: { ...localAdapters(), workflow: f.ports },
  }).run(p, "on-event", "input");
  expect(result.status).toBe("failed");
  expect(
    result.events.some(
      (e) => e.blockId === "set" || e.type === "checkpoint.created",
    ),
  ).toBe(false);
  expect(result.workflow?.moduleId).toBe("main");
});

it("reopens a completed task without replaying events consumed by the same Runtime", async () => {
  const p = project(),
    f = fixture();
  const root = p.workspaces.main.blocks.blocks[0].inputs!.HANDLER!.block!;
  const second = root.inputs!.STEPS!.block!.next!.block!.next!.block!;
  second.inputs!.DO = { block: second.inputs!.DO!.block!.next!.block! };
  p.workspaces.main.blocks.blocks.push(
    block(
      "consume-entry",
      "core.interaction.chat_entry",
      { NAME: "Consume" },
      {
        CAPABILITIES: {
          block: block("consume-text", "core.interaction.accept_text"),
        },
        HANDLER: {
          block: stack(
            block("consume-event", "core.event.receive", {
              CHANNEL: "jobs",
              TIMEOUT_MS: "0",
            }),
            block("event-file", "core.output.file", {
              NAME: "event.json",
              FORMAT: "json",
            }),
          ),
        },
      },
    ),
  );
  const runtime = new Runtime({
    adapters: { ...localAdapters(), workflow: f.ports },
  });
  expect((await runtime.run(p, "on-event", "input")).status).toBe("waiting");
  f.decide("approve");
  expect(
    (
      await runtime.run(p, "on-event", "input", {
        workflowTaskId: "task-owned",
      })
    ).status,
  ).toBe("completed");
  const consumed = await runtime.run(p, "consume-entry", "input");
  expect(consumed.status).toBe("completed");
  expect(JSON.parse(consumed.files![0].content)).toEqual({ saved: true });
  const revision = f.record.revision;
  const reopened = await runtime.run(p, "on-event", "input", {
    workflowTaskId: "task-owned",
  });
  expect(reopened.status).toBe("completed");
  expect(reopened.structured).toEqual({ saved: true });
  expect(f.record.revision).toBe(revision);
  const empty = await runtime.run(p, "consume-entry", "input");
  expect(empty.status).toBe("completed");
  expect(JSON.parse(empty.files![0].content)).toBeNull();
});

it("cancels recovery while citation validation is pending and closes without restoring or advancing", async () => {
  const p = project(),
    f = fixture();
  await new Runtime({
    adapters: { ...localAdapters(), workflow: f.ports },
  }).run(p, "on-event", "input");
  const state = f.record.state as { presentation: { citations: unknown[] } };
  state.presentation.citations = [
    {
      id: "cite",
      title: "Synthetic",
      text: "Synthetic",
      collectionId: "owned-collection",
    },
  ];
  f.decide("approve");
  const before = canonicalJson(f.record),
    controller = new AbortController();
  let enter!: () => void,
    release!: () => void,
    closed = false;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const validation = new Promise<void>((resolve) => {
    release = resolve;
  });
  const open = f.ports.open;
  f.ports.open = async (request, signal) => {
    const handle = await open(request, signal);
    return {
      ...handle,
      close: async () => {
        await handle.close();
        closed = true;
      },
    };
  };
  const run = new Runtime({
    adapters: {
      ...localAdapters(),
      workflow: f.ports,
      agent: {
        validateCitations: async () => {
          enter();
          await validation;
        },
      },
    },
  }).run(p, "on-event", "different-input", {
    workflowTaskId: "task-owned",
    signal: controller.signal,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await entered;
    controller.abort();
    const status = await Promise.race([
      run.then((result) => result.status),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("still-pending"), 250);
      }),
    ]);
    expect(status).toBe("cancelled");
    expect(closed).toBe(true);
    expect(canonicalJson(f.record)).toBe(before);
    const result = await run;
    expect(
      result.events.some(
        (event) =>
          event.type === "checkpoint.created" || event.blockId === "second",
      ),
    ).toBe(false);
  } finally {
    clearTimeout(timer);
    release();
    await run;
  }
});
