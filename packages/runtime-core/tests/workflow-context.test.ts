import { expect, it } from "vitest";
import { createArchitectureStarter } from "../../block-catalog/src";
import { AgentExecution } from "../src/agent-execution";
import { EventMailbox } from "../src/event-mailbox";
import { RunBudget } from "../src/budget";

it("restores private execution values, scoped memory and queued events without restoring services or model-call evidence", async () => {
  const project = createArchitectureStarter("event-mailbox"),
    budget = new RunBudget(),
    nextBudget = new RunBudget();
  const agent = new AgentExecution(
    project,
    "original-input",
    "run-old",
    "session-old",
    budget,
  );
  try {
    agent.value = { saved: true };
    agent.instruction = "private instruction";
    await agent.execute(
      {
        nodeId: "write",
        blockType: "core.memory.write",
        fields: { SCOPE: "session", KEY: "state", SOURCE: "result" },
        inputs: {},
      },
      async () => {},
    );
    await agent.execute(
      {
        nodeId: "send",
        blockType: "core.event.send",
        fields: { CHANNEL: "jobs", SOURCE: "result" },
        inputs: {},
      },
      async () => {},
    );
    agent.generations.push({
      text: "history",
      provider: "synthetic",
      model: "synthetic",
      transport: "remote",
      requestId: "old-request",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const snapshot = agent.checkpoint();
    expect(JSON.stringify(snapshot)).not.toContain("old-request");
    const restored = new AgentExecution(
      project,
      "new-input",
      "run-new",
      "session-new",
      nextBudget,
    );
    restored.restoreCheckpoint(snapshot);
    expect(restored.question).toBe("original-input");
    expect(restored.instruction).toBe("private instruction");
    expect(restored.generations).toEqual([]);
    await restored.execute(
      {
        nodeId: "read",
        blockType: "core.memory.read",
        fields: { SCOPE: "session", KEY: "state" },
        inputs: {},
      },
      async () => {},
    );
    expect(restored.value).toEqual({ saved: true });
    await restored.execute(
      {
        nodeId: "receive",
        blockType: "core.event.receive",
        fields: { CHANNEL: "jobs", TIMEOUT_MS: "0" },
        inputs: {},
      },
      async () => {},
    );
    expect(restored.value).toEqual({ saved: true });
    expect(restored.checkpoint().events).toEqual([]);
  } finally {
    budget.dispose();
    nextBudget.dispose();
  }
});
it("rejects a conflicting mailbox or memory snapshot before changing any live state", async () => {
  const project = createArchitectureStarter("event-mailbox"),
    budget = new RunBudget(),
    targetBudget = new RunBudget();
  const mailbox = new EventMailbox();
  const signal = new AbortController().signal;
  const source = new AgentExecution(
    project,
    "saved",
    "run-source",
    "session-source",
    budget,
  );
  const target = new AgentExecution(
    project,
    "live",
    "run-target",
    "session-target",
    targetBudget,
    {},
    undefined,
    new Map(),
    mailbox,
  );
  try {
    const snapshot = source.checkpoint();
    mailbox.send(project.manifest.projectId, "inbox", "keep", signal);
    target.value = "untouched";
    expect(() => target.restoreCheckpoint(snapshot)).toThrow(
      "BLK-WORKFLOW-CONTEXT",
    );
    expect(target.question).toBe("live");
    expect(target.value).toBe("untouched");
    expect(
      await mailbox.receive(project.manifest.projectId, "inbox", 0, signal),
    ).toEqual({ payload: "keep" });
    expect(() =>
      target.restoreCheckpoint({ ...snapshot, grants: ["forged"] }),
    ).toThrow();
    expect(() =>
      target.restoreCheckpoint({ ...snapshot, projectId: "another-project" }),
    ).toThrow("BLK-WORKFLOW-BINDING");
  } finally {
    budget.dispose();
    targetBudget.dispose();
  }
});
it("preserves consumed budget and deadline instead of minting fresh limits on resume", () => {
  const old = new RunBudget(),
    next = new RunBudget();
  try {
    old.configure({
      STEPS: "10",
      CALLS: "2",
      OUTPUT_TOKENS: "128",
      TIMEOUT_MS: "1000",
    });
    old.step();
    old.call();
    old.reserveOutput(100);
    const snapshot = old.checkpoint();
    next.restoreCheckpoint(snapshot);
    expect(next.steps).toBe(1);
    expect(next.calls).toBe(1);
    expect(next.reserveOutput(50)).toBe(28);
    expect(() => next.reserveOutput(1)).toThrow("BLK-RUN-004");
    expect(() =>
      next.restoreCheckpoint({ ...snapshot, maxCalls: 17 }),
    ).toThrow();
  } finally {
    old.dispose();
    next.dispose();
  }
});

it("projects completed output while preserving current input, values, memory and event consumption", () => {
  const project = createArchitectureStarter("event-mailbox"),
    budget = new RunBudget();
  const memory = new Map([
    [
      JSON.stringify([project.manifest.projectId, "current", "progress"]),
      "current-memory",
    ],
  ]);
  const agent = new AgentExecution(
    project,
    "current-input",
    "run-current",
    "current",
    budget,
    {},
    undefined,
    memory,
  );
  try {
    agent.value = "current-value";
    agent.memory = "current-context";
    agent.instruction = "current-instruction";
    const snapshot = {
      ...agent.checkpoint(),
      question: "old-input",
      value: "old-value",
      memory: "old-context",
      instruction: "old-instruction",
      requireEvidence: true,
      generated: "saved answer",
      structured: { saved: true },
      files: [
        {
          name: "saved.json",
          format: "json" as const,
          content: '{"saved":true}',
        },
      ],
      sessionMemory: [{ key: "progress", value: "old-memory" }],
      events: [{ channel: "jobs", payload: "consumed" }],
    };
    agent.restoreCompletedOutput(snapshot);
    expect(agent.checkpoint()).toMatchObject({
      question: "current-input",
      value: "current-value",
      memory: "current-context",
      instruction: "current-instruction",
      requireEvidence: false,
      sessionMemory: [{ key: "progress", value: "current-memory" }],
      events: [],
      generated: "saved answer",
      structured: { saved: true },
      files: [
        { name: "saved.json", format: "json", content: '{"saved":true}' },
      ],
    });
    expect(() =>
      agent.restoreCompletedOutput({ ...snapshot, projectId: "foreign" }),
    ).toThrow("BLK-WORKFLOW-BINDING");
    expect(agent.generations).toEqual([]);
  } finally {
    budget.dispose();
  }
});
