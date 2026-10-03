import { expect, it, vi } from "vitest";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import { compileProject } from "../../compiler/src";
import { Runtime, localAdapters } from "../src";
import type { Generation, GenerationRequest } from "../src/agent-context";
import type { Resource, WorkspaceBlock } from "@blocky/language-schema";

function fixture(resourceId = "text-tool") {
  const project = createAgentExample("loop-runtime");
  project.resources["agent-model"].definition.capabilities = ["text", "tools"];
  const root = project.workspaces["research-agent"].blocks.blocks[0];
  const budget: WorkspaceBlock = {
    type: "core.run.budget",
    id: "limits",
    fields: {
      STEPS: "100",
      CALLS: "8",
      OUTPUT_TOKENS: "2048",
      TIMEOUT_MS: "30000",
    },
  };
  const loop: WorkspaceBlock = {
    type: "core.reason.tool_loop",
    id: "decide",
    fields: { RESOURCE: "agent-model", MAX_TURNS: "4", OUTPUT_TOKENS: "256" },
    inputs: {
      TOOLS: {
        block: {
          type: "core.tool.expose",
          id: "expose",
          fields: { RESOURCE: resourceId },
        },
      },
    },
    next: {
      block: {
        type: "core.output.answer",
        id: "answer",
        fields: { STYLE: "段落" },
      },
    },
  };
  budget.next = { block: loop };
  root.inputs!.BODY.block!.next = { block: budget };
  return { project, budget, loop };
}
function generation(
  text: string,
  calls: Generation["toolCalls"] = [],
): Generation {
  return {
    schemaVersion: "blocky.model-response/v2",
    provider: "unit-fixture",
    model: "unit-fixture",
    transport: "local",
    requestId: "response-fixture",
    usage: null,
    usageStatus: "unavailable",
    finishReason: calls.length ? "tool_calls" : "stop",
    toolCalls: calls,
    text,
  };
}
function services() {
  const requests: GenerationRequest[] = [],
    effects: string[] = [];
  const adapters = localAdapters();
  adapters.agent = {
    ...adapters.agent,
    generate: async (request) => {
      requests.push(structuredClone(request));
      if (requests.length === 1)
        return generation("", [
          { id: "first", name: "tool_1", arguments: { input: "hello world" } },
        ]);
      if (requests.length === 2) {
        expect(JSON.parse(request.messages.at(-1)!.content).words).toBe(2);
        return generation("", [
          {
            id: "second",
            name: "tool_1",
            arguments: { input: "2 words counted" },
          },
        ]);
      }
      expect(JSON.parse(request.messages.at(-1)!.content).words).toBe(3);
      return generation("The second input contains three words.");
    },
    tool: async ({ input }) => {
      const text = String(input);
      effects.push(text);
      return {
        words: text.split(/\s+/).length,
        characters: text.length,
        lines: 1,
      };
    },
  };
  return { adapters, requests, effects };
}
it("runs a compiled model loop and emits correlated real tool receipts without executing declarations", async () => {
  const { project } = fixture(),
    { adapters, requests, effects } = services();
  expect((await compileProject(project)).diagnostics).toEqual([]);
  const result = await new Runtime({
    adapters,
    capabilities: ["text.analyze"],
  }).run(project, "on-question", "count twice");
  expect(result.status, JSON.stringify(result.events.at(-1))).toBe("completed");
  expect(result.answer).toBe("The second input contains three words.");
  expect(effects).toEqual(["hello world", "2 words counted"]);
  expect(requests.map((r) => r.messages.length)).toEqual([2, 4, 6]);
  expect(result.generations).toHaveLength(3);
  expect(JSON.stringify(result.generations)).not.toContain("hello world");
  expect(result.modelApiCalled).toBe(false);
  expect(
    result.events.some(
      (e) => e.blockId === "expose" && e.type === "block.started",
    ),
  ).toBe(false);
  expect(result.events.filter((e) => e.type === "tool.completed")).toHaveLength(
    2,
  );
});
it("calls typed module tools with isolated input and shares the parent budget", async () => {
  const { project, budget } = fixture("module-count"),
    { adapters, effects } = services();
  const resource: Resource = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "module-count",
    kind: "tool",
    scope: "project",
    displayName: "Count through a project module",
    definition: {
      version: "1",
      permissions: ["module.execute"],
      implementationRef: { kind: "adapter", id: "module-tool-v1" },
      moduleId: "counter",
      exportId: "count",
      inputSchemaRef: { kind: "schema", id: "text-input" },
      outputSchemaRef: { kind: "schema", id: "text-result" },
    },
    capabilityRequirements: ["module.execute"],
    secretBindings: [],
  };
  resource.definition.inputSchemaJson = JSON.stringify(
    project.schemas["schemas/text-input.json"],
  );
  resource.definition.outputSchemaJson = JSON.stringify(
    project.schemas["schemas/text-result.json"],
  );
  resource.definition.timeoutMs = 30000;
  project.resources[resource.resourceId] = resource;
  project.manifest.resources.push({
    resourceId: resource.resourceId,
    kind: "tool",
    scope: "project",
    definitionRef: "resources/module-count.json",
    secretRefs: [],
  });
  project.manifest.modules.push({
    moduleId: "counter",
    displayName: "Counter",
    purpose: "general",
    workspaceRef: "workspaces/counter.workspace.json",
    exports: [
      {
        exportId: "count",
        displayName: "Count",
        kind: "tool",
        inputSchemaRef: "schemas/text-input.json",
        outputSchemaRef: "schemas/text-result.json",
      },
    ],
  });
  project.workspaces.counter = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "core.tool.entry",
          id: "count-entry",
          fields: { EXPORT: "count" },
          inputs: {
            BODY: {
              block: {
                type: "core.tool.invoke",
                id: "count-text",
                fields: { RESOURCE: "text-tool", SOURCE: "input" },
                next: {
                  block: {
                    type: "core.output.structured",
                    id: "counter-output",
                    fields: { SCHEMA: "schemas/text-result.json" },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
  expect((await compileProject(project)).diagnostics).toEqual([]);
  const result = await new Runtime({
    adapters,
    capabilities: ["text.analyze", "module.execute"],
  }).run(project, "on-question", "original parent input");
  expect(result.status, JSON.stringify(result.events.at(-1))).toBe("completed");
  expect(result.answer).toBe("The second input contains three words.");
  expect(effects).toEqual(["hello world", "2 words counted"]);
  expect(result.structured).toBeUndefined();
  expect(
    result.events.filter(
      (e) =>
        e.moduleId === "counter" &&
        e.blockId === "count-text" &&
        e.type === "block.completed",
    ),
  ).toHaveLength(2);
  const limited = services();
  budget.fields!.CALLS = "2";
  const failed = await new Runtime({
    adapters: limited.adapters,
    capabilities: ["text.analyze", "module.execute"],
  }).run(project, "on-question", "original parent input");
  expect(failed.status).toBe("failed");
  expect(failed.events.at(-1)?.data.code).toBe("BLK-RUN-004");
  expect(limited.effects).toEqual([]);
});
it("refuses missing tool permissions before model requests and cancels pending calls", async () => {
  const { project } = fixture(),
    first = services();
  expect(
    (
      await new Runtime({ adapters: first.adapters, capabilities: [] }).run(
        project,
        "on-question",
        "x",
      )
    ).status,
  ).toBe("failed");
  expect(first.requests).toEqual([]);
  const second = services(),
    controller = new AbortController();
  second.adapters.agent!.tool = async () => {
    controller.abort();
    return new Promise(() => {});
  };
  const cancelled = await new Runtime({
    adapters: second.adapters,
    capabilities: ["text.analyze"],
  }).run(project, "on-question", "x", { signal: controller.signal });
  expect(cancelled.status).toBe("cancelled");
  expect(second.requests).toHaveLength(1);
  expect(
    cancelled.events.filter((e) => e.type === "run.cancelled"),
  ).toHaveLength(1);
});
it("publishes the cancelled terminal only after native services have settled", async () => {
  const { project } = fixture(),
    { adapters } = services(),
    controller = new AbortController();
  let finish!: () => void;
  adapters.agent!.tool = async () => {
    controller.abort();
    return new Promise(() => {});
  };
  adapters.agent!.close = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const terminal: string[] = [];
  const pending = new Runtime({ adapters }).run(project, "on-question", "x", {
    signal: controller.signal,
    onEvent: (event) => {
      if (["run.completed", "run.cancelled", "run.failed"].includes(event.type))
        terminal.push(event.type);
    },
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(terminal).toEqual([]);
  finish();
  expect((await pending).status).toBe("cancelled");
  expect(terminal).toEqual(["run.cancelled"]);
});
