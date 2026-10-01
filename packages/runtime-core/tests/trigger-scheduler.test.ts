import { describe, expect, it, vi } from "vitest";
import { createArchitectureStarter } from "../../block-catalog/src";
import { Runtime } from "../src/runtime";
import { localAdapters } from "../src/adapters";
import { createWorkflow, transitionWorkflow, type WorkflowRecord } from "../src/workflow";
import type { WorkflowPorts } from "../src/workflow/runtime";
import type {
  TriggerClient,
  TriggerRecord,
} from "../src/trigger-api";
import type { TriggerConfig } from "../src/triggers";
import type { RunResult } from "../src/runtime";
import { TriggerScheduler } from "../src/trigger-scheduler";

function timerConfig(projectId: string): TriggerConfig {
  return {
    schemaVersion: "blocky.trigger/v1" as const,
    triggerId: "timer-one",
    projectId,
    moduleId: "main",
    exportId: "on-event",
    revision: 1,
    enabled: true,
    type: "timer" as const,
    schedule: {
      kind: "once" as const,
      startsAt: 1_000,
      timeZone: "+08:00",
      misfire: "latest" as const,
    },
  };
}

function durableProject() {
  const project = createArchitectureStarter("durable-workflow");
  const entry = project.workspaces.main!.blocks.blocks[0]!;
  const workflow = entry.inputs?.HANDLER?.block;
  const steps = workflow?.inputs?.STEPS?.block;
  if (!steps?.next?.block || steps.next.block.type !== "core.human.approve") throw Error("fixture missing approval step");
  steps.next = steps.next.block.next;
  return project;
}

function memoryWorkflowPorts(): WorkflowPorts {
  const records = new Map<string, WorkflowRecord>();
  let next = 0;
  return {
    async open(request) {
      const taskId = request.taskId ?? `workflow-${++next}`;
      if (!request.taskId) records.set(taskId, createWorkflow(taskId, request.definition, request.initial));
      const current = records.get(taskId);
      if (!current) throw Error("BLK-WORKFLOW-NOT-FOUND");
      return {
        taskId,
        store: {
          async read() { return structuredClone(records.get(taskId)!); },
          async commit(_revision, action) {
            const changed = transitionWorkflow(records.get(taskId)!, action);
            records.set(taskId, changed);
            return structuredClone(changed);
          },
        },
        async close() {},
      };
    },
  };
}

function claimedRecord(config: TriggerConfig): TriggerRecord {
  return {
    projectId: config.projectId,
    triggerId: config.triggerId,
    configRevision: config.revision,
    moduleId: config.moduleId,
    exportId: config.exportId,
    occurrenceId: `${config.projectId}:${config.triggerId}:r1:timer:1000`,
    scheduledAt: 1_000,
    kind: "timer",
    claimRevision: 1,
    status: "claimed",
  };
}

class MemoryTriggerClient implements TriggerClient {
  calls: string[] = [];
  records: TriggerRecord[] = [];
  constructor(readonly config: TriggerConfig) {}

  async list() {
    return [{ config: this.config, occurrences: [...this.records] }];
  }
  async read() {
    return this.config;
  }
  async upsert(config: TriggerConfig) {
    return config;
  }
  async pause() {
    return this.config;
  }
  async claim() {
    this.calls.push("claim");
    const existing = this.records[0];
    if (existing) return { claimed: false, record: existing };
    if (this.config.type !== "timer" || this.config.schedule.kind !== "once" || this.config.schedule.misfire !== "latest")
      throw Error("timer fixture required");
    const record = claimedRecord(this.config);
    this.records.push(record);
    return { claimed: true, record };
  }
  async complete(
    _triggerId: string,
    _occurrenceId: string,
    claimRevision: number,
    result: {
      status: "completed" | "failed";
      workflowTaskId: string;
      stableErrorCode?: string;
    },
  ) {
    this.calls.push(`complete:${_occurrenceId}:${result.status}`);
    const index = this.records.findIndex((record) => record.occurrenceId === _occurrenceId);
    const record = {
      ...this.records[index]!,
      status: result.status,
      claimRevision: claimRevision + 1,
      workflowTaskId: result.workflowTaskId,
      ...(result.stableErrorCode
        ? { stableErrorCode: result.stableErrorCode }
        : {}),
    } as TriggerRecord;
    this.records[index] = record;
    return record;
  }
}

describe("shared trigger scheduler", () => {
  it("claims durably before running a fresh real Runtime and disposes it after settlement", async () => {
    const project = durableProject();
    const client = new MemoryTriggerClient(timerConfig(project.manifest.projectId));
    const order: string[] = [];
    const createRuntime = vi.fn(async () => {
      order.push("runtime");
      client.calls.push("runtime");
      return {
        project,
        runtime: new Runtime({ adapters: { ...localAdapters(), workflow: memoryWorkflowPorts() } }),
        dispose() {
          order.push("dispose");
          client.calls.push("dispose");
        },
      };
    });
    const scheduler = new TriggerScheduler({
      client,
      createRuntime,
      now: () => 2_000,
      pollIntervalMs: 1_000,
    });

    const outcome = await scheduler.runDue(
      "timer-one",
      new AbortController().signal,
    );
    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") throw Error("expected completion");
    expect(outcome.result.status).toBe("completed");
    expect(outcome.result.modelApiCalled).toBe(false);
    expect(client.calls).toEqual([
      "runtime",
      "claim",
      "dispose",
      `complete:${outcome.record.occurrenceId}:completed`,
    ]);
    expect(createRuntime).toHaveBeenCalledTimes(1);
  });

  it("keeps private revision bookkeeping out of subsequent timer observations", async () => {
    const project = durableProject();
    const client = new MemoryTriggerClient(timerConfig(project.manifest.projectId));
    let now = 500;
    const createRuntime = vi.fn(() => ({project,runtime:new Runtime({adapters:{...localAdapters(),workflow:memoryWorkflowPorts()}}),dispose(){}}));
    const scheduler = new TriggerScheduler({client,createRuntime,now:()=>now});
    const signal = new AbortController().signal;
    expect(await scheduler.runDue("timer-one",signal)).toMatchObject({kind:"skipped",reason:"not-due"});
    now=750;
    expect(await scheduler.runDue("timer-one",signal)).toMatchObject({kind:"skipped",reason:"not-due"});
    now=1000;
    expect(await scheduler.runDue("timer-one",signal)).toMatchObject({kind:"completed"});
    now=1250;
    expect(await scheduler.runDue("timer-one",signal)).toMatchObject({kind:"skipped",reason:"not-due"});
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(client.records).toHaveLength(1);
  });

  it("does not retry a prior claimed occurrence after an uncertain interruption", async () => {
    const project = durableProject();
    const client = new MemoryTriggerClient(timerConfig(project.manifest.projectId));
    client.records.push(claimedRecord(timerConfig(project.manifest.projectId)));
    const createRuntime = vi.fn(async () => {
      throw Error("must not execute an old claim");
    });
    const scheduler = new TriggerScheduler({
      client,
      createRuntime,
      now: () => 2_000,
      pollIntervalMs: 1_000,
    });

    const outcome = await scheduler.runDue(
      "timer-one",
      new AbortController().signal,
    );

    expect(outcome.kind).toBe("blocked");
    if (outcome.kind !== "blocked") throw Error("expected old claim to block new run");
    expect(outcome.reason).toBe("unsettled-claim");
    expect(createRuntime).not.toHaveBeenCalled();
    expect(client.records[0]?.status).toBe("claimed");
  });

  it("keeps cancelled Runtime claims reserved and never retries uncertain work", async () => {
    const project = durableProject();
    const client = new MemoryTriggerClient(timerConfig(project.manifest.projectId));
    const controller = new AbortController();
    const order: string[] = [];
    const scheduler = new TriggerScheduler({
      client,
      createRuntime: async () => {
        client.calls.push("runtime");
        return {
          project,
          runtime: new Runtime({ adapters: { ...localAdapters(), workflow: memoryWorkflowPorts() } }),
          dispose() { order.push("dispose"); },
        };
      },
      now: () => 2_000,
      pollIntervalMs: 1_000,
      onEvent(event) {
        if (event.type === "run.started") controller.abort();
      },
    });

    const outcome = await scheduler.runDue("timer-one", controller.signal);

    expect(outcome.kind).toBe("blocked");
    if (outcome.kind !== "blocked") throw Error("expected an uncertain claim");
    expect(outcome.errorCode).toBe("BLK-RUN-005");
    expect(order).toEqual(["dispose"]);
    expect(client.calls).toEqual(["runtime", "claim"]);
    expect(client.records[0]?.status).toBe("claimed");
  });

  it("executes only direct poll siblings in order and discards the rest after a non-completed run", async () => {
    const project = durableProject();
    const config = {
      schemaVersion: "blocky.trigger/v1" as const, triggerId: "external-one",
      projectId: project.manifest.projectId, moduleId: "main", exportId: "on-event",
      revision: 1, enabled: true, type: "external" as const, sourceId: "source-one",
    };
    const client = new MemoryTriggerClient(config);
    const record = (eventId: string): TriggerRecord => ({
      projectId: config.projectId, triggerId: config.triggerId, configRevision: 1,
      moduleId: config.moduleId, exportId: config.exportId,
      occurrenceId: `${config.projectId}:${config.triggerId}:r1:external:${eventId}`,
      scheduledAt: 1_000, kind: "external", eventId, claimRevision: 1, status: "claimed",
    });
    const first = record("event-one"), second = record("event-two"), third = record("event-three");
    client.records.push(first, second, third);
    const inputs: string[] = [];
    let runCount = 0;
    const scheduler = new TriggerScheduler({
      client,
      createRuntime: async () => ({
        project,
        runtime: { async run(_project, _entry, input) {
          inputs.push(input);
          runCount++;
          return {
            status: runCount === 1 ? "completed" : "waiting", answer: "private output", citations: [], events: [],
            workflow: { taskId: `workflow-${runCount}` }, modelApiCalled: false,
          } as unknown as RunResult;
        } },
        dispose() {},
      }),
    });

    const firstOutcome = await scheduler.runExternal(first, { value: 1 }, new AbortController().signal, [first.occurrenceId, second.occurrenceId, third.occurrenceId]);
    expect(firstOutcome.kind).toBe("completed");
    expect(client.records[0]?.status).toBe("completed");
    const secondOutcome = await scheduler.runExternal(second, { value: 2 }, new AbortController().signal, [second.occurrenceId, third.occurrenceId]);
    expect(secondOutcome.kind).toBe("blocked");
    expect(client.records[1]?.status).toBe("claimed");
    expect(client.records[2]?.status).toBe("claimed");
    expect(inputs).toEqual(['{"value":1}', '{"value":2}']);
    expect(client.calls).toEqual([`complete:${first.occurrenceId}:completed`]);
    const replay = await scheduler.runExternal(third, { value: 3 }, new AbortController().signal, [third.occurrenceId]);
    expect(replay.kind).toBe("blocked");
    expect(runCount).toBe(2);
  });
});
