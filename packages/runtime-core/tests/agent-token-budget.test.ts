import { expect, it } from "vitest";
import { RunBudget } from "../src/budget";
import { AgentExecution } from "../src/agent-execution";
import { nativeModelRequest } from "../src/native-model";
import { runPiLoop } from "../src/pi-loop";
import { Runtime, localAdapters } from "../src";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import { createStartingBlueprint, walkBlocks } from "../../block-catalog/src";
import type { Generation, GenerationRequest } from "../src/agent-context";
import type { ToolLoopContext } from "../src/tool-loop";

const response = (text: string, outputTokens = 5000): Generation => ({
  text,
  finishReason: "stop",
  provider: "unit-fixture",
  transport: "local",
  model: "unit-model",
  requestId: "unit-reply",
  usage: {
    inputTokens: 90000,
    outputTokens,
    totalTokens: 90000 + outputTokens,
  },
});
it("charges reported output even when a returned answer fails the evidence guard", async () => {
  const project = createAgentExample("rejected-answer"), budget = new RunBudget();
  const model = project.resources["agent-model"];
  model.definition.implementationRef = { kind: "adapter", id: "ollama-v1" };
  model.definition.parameters = { maxOutputTokens: 32768 };
  const execution = new AgentExecution(project, "question", "run-test", "session-test", budget, { generate: async () => response("[source:invented]", 5000) });
  try {
    await expect(execution.compose(model, "reader", [], "model-test")).rejects.toThrow("BLK-GUARD-001");
    expect(execution.generated).toBeUndefined();
    expect(budget.usedOutput).toBe(5000);
  } finally { budget.dispose(); }
});
it("raises editable blueprint defaults and accepts a larger user quota without rewriting a legacy budget", () => {
  for (const id of [
    "knowledge-assistant",
    "work-assistant",
    "coding-assistant",
    "pi-agent",
  ]) {
    const blocks = [
      ...walkBlocks(createStartingBlueprint(id).workspaces.main.blocks.blocks),
    ];
    expect(
      blocks.find((b) => b.type === "core.run.budget")?.fields,
    ).toMatchObject({
      OUTPUT_TOKENS: "1048576",
      CALLS: "256",
      TIMEOUT_MS: "1800000",
    });
    const loop = blocks.find((b) => b.type === "core.reason.tool_loop");
    if (loop)
      expect(loop.fields).toMatchObject({
        OUTPUT_TOKENS: "32768",
        MAX_TURNS: "32",
      });
  }
  const budget = new RunBudget();
  const restored = new RunBudget();
  try {
    budget.configure({
      STEPS: "10000",
      CALLS: "256",
      OUTPUT_TOKENS: "2097152",
      TIMEOUT_MS: "3600000",
    });
    expect(budget.maxOutput).toBe(2097152);
    const reserved = budget.reserveOutput(65536);
    budget.settleOutput(reserved, 5000);
    expect(budget.usedOutput).toBe(5000);
    restored.restoreCheckpoint(budget.checkpoint());
    expect(restored.maxOutput).toBe(2097152);
    expect(restored.usedOutput).toBe(5000);
    expect(restored.checkpoint().remainingMs).toBeLessThanOrEqual(
      budget.checkpoint().remainingMs + 10,
    );
    expect(() =>
      restored.configure({
        STEPS: "100",
        CALLS: "16",
        OUTPUT_TOKENS: "4096",
        TIMEOUT_MS: "120000",
      }),
    ).toThrow("BLK-RUN-004");
    expect(restored.usedOutput).toBe(5000);
  } finally {
    budget.dispose();
    restored.dispose();
  }
});
it("uses v2 for large legacy-provider requests and respects a model's explicit smaller output setting", () => {
  const model = createAgentExample("request-budget").resources["agent-model"];
  model.scope = "user";
  model.secretBindings = [{ fieldId: "apiKey", secretRef: "test-key" }];
  model.definition = {
    provider: "deepseek",
    protocol: "openai-chat",
    modelId: "fixture",
    timeoutMs: 60000,
    capabilities: ["text"],
    implementationRef: { kind: "adapter", id: "deepseek-v1" },
  };
  const request: GenerationRequest = {
    projectId: "request-budget",
    resource: model,
    requestId: "reply",
    messages: [{ role: "user", content: "long answer" }],
    maxOutputTokens: 65536,
  };
  expect(nativeModelRequest(request)).toMatchObject({
    call: "provider-model-call",
    request: { maxOutputTokens: 65536 },
  });
  model.definition.parameters = { maxOutputTokens: 16384 };
  expect(nativeModelRequest(request).request.maxOutputTokens).toBe(16384);
});
it.each(["pi", "blocky"])(
  "passes a long response through %s and charges reported output only",
  async (engine) => {
    const project = createStartingBlueprint("pi-agent");
    const fixture = createAgentExample("fixture");
    const budget = new RunBudget();
    const text = "long answer detail. ".repeat(6000);
  fixture.resources["agent-model"].definition.parameters = { maxOutputTokens: 32768 };
    const context: ToolLoopContext = {
      project,
      model: fixture.resources["agent-model"],
      budget,
      capabilities: [],
      requestId: "budget-test",
      question: "answer",
      role: "reader",
      instruction: "",
      memory: null,
      value: null,
      citations: [],
      requireEvidence: false,
      resourceIds: [],
      maxTurns: 32,
      outputPerTurn: 32768,
      generate: async (request) => {
        expect(request.maxOutputTokens).toBe(32768);
        return response(text);
      },
      invoke: async () => null,
      onGeneration() {},
      onEvent() {},
    };
    try {
      if (engine === "pi") expect(await runPiLoop(context)).toBe(text);
      else {
        const { runToolLoop } = await import("../src/tool-loop");
        context.project = fixture;
        context.resourceIds = ["text-tool"];
        context.capabilities = ["text.analyze"];
        expect(await runToolLoop(context)).toBe(text);
      }
      expect(budget.usedOutput).toBe(5000);
    } finally {
      budget.dispose();
    }
  },
);
it("runs and restores the work blueprint after a response larger than the former memory limit", async () => {
  const project = createStartingBlueprint("work-assistant"),
    fixture = createAgentExample("fixture");
  project.resources["assistant-model"] = {
    ...fixture.resources["agent-model"],
    resourceId: "assistant-model",
  };
  project.resources["assistant-model"].definition.capabilities = [
    "text",
    "tools",
  ];
  project.resources["assistant-model"].definition.parameters = { maxOutputTokens: 32768 };
  project.manifest.resources.push({
    resourceId: "assistant-model",
    kind: "model",
    scope: "project",
    definitionRef: "resources/assistant-model.json",
    secretRefs: [],
  });
  const text = "actual output detail. ".repeat(5000);
  const adapters = localAdapters();
  adapters.agent = {
    generate: async (request) => {
      expect(request.maxOutputTokens).toBe(32768);
      return response(text);
    },
  };
  const runtime = new Runtime({ adapters });
  const first = await runtime.run(
    project,
    "assistant-chat-trigger",
    "write report",
    { moduleId: "main" },
  );
  expect(first.status, JSON.stringify(first.events)).toBe("completed");
  expect(first.answer).toContain(text);
  const restored = new Runtime({
    adapters,
    sessionState: runtime.captureSession(),
  });
  expect(
    (
      await restored.run(project, "assistant-chat-trigger", "continue", {
        moduleId: "main",
      })
    ).status,
  ).toBe("completed");
});
it("continues above the old turn/call limits using output usage instead of summing reservations", async () => {
  const project = createAgentExample("extended-loop"),
    budget = new RunBudget();
  let turn = 0,
    invoked = 0;
  project.resources["agent-model"].definition.parameters = { maxOutputTokens: 32768 };
  const context: ToolLoopContext = {
    project,
    model: project.resources["agent-model"],
    budget,
    capabilities: ["text.analyze"],
    requestId: "extended-loop",
    question: "process all",
    role: "worker",
    instruction: "",
    memory: null,
    value: null,
    citations: [],
    requireEvidence: false,
    resourceIds: ["text-tool"],
    maxTurns: 45,
    outputPerTurn: 32768,
    generate: async () => {
      const result = response(++turn === 45 ? "all processed" : "", 5000);
      if (turn < 45) {
        result.finishReason = "tool_calls";
        result.toolCalls = [
          {
            id: `part-${turn}`,
            name: "tool_1",
            arguments: { input: `part ${turn}` },
          },
        ];
      }
      return result;
    },
    invoke: async () => {
      invoked++;
      return { words: 2, characters: 7, lines: 1 };
    },
    onGeneration() {},
    onEvent() {},
  };
  try {
    expect(await runPiLoop(context)).toBe("all processed");
    expect(turn).toBe(45);
    expect(invoked).toBe(44);
    expect(budget.usedOutput).toBe(225000);
    expect(budget.calls).toBe(89);
  } finally {
    budget.dispose();
  }
});
it("keeps explicit small quotas and cannot replenish a restored run by later configuring a larger one", () => {
  const budget = new RunBudget(),
    restored = new RunBudget();
  try {
    budget.configure({
      STEPS: "100",
      CALLS: "16",
      OUTPUT_TOKENS: "4096",
      TIMEOUT_MS: "120000",
    });
    expect(budget.reserveOutput(32768)).toBe(4096);
    expect(() => budget.reserveOutput(1)).toThrow("BLK-RUN-004");
    restored.restoreCheckpoint(budget.checkpoint());
    restored.configure({
      STEPS: "10000",
      CALLS: "256",
      OUTPUT_TOKENS: "2097152",
      TIMEOUT_MS: "3600000",
    });
    expect(restored.maxOutput).toBe(4096);
    expect(() => restored.reserveOutput(1)).toThrow("BLK-RUN-004");
    expect(() => restored.settleOutput(4096, 4097)).toThrow();
    expect(restored.usedOutput).toBe(4096);
  } finally {
    budget.dispose();
    restored.dispose();
  }
});
