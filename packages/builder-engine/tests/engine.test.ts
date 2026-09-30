import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { runBuilderEngine } from "../src";

const request = {
  schemaVersion: "blocky.builder-request/v1",
  requestId: "engine-request",
  projectId: "research-workbench",
  intent: "build",
  prompt: "改为植物课堂助手",
  moduleId: "research-agent",
  selection: [],
  createSurface: false,
};
const response = {
  content: [
    {
      type: "toolCall",
      id: "draft-1",
      name: "draft",
      arguments: { plan: ["调整角色"], acceptanceCriteria: ["编译通过"] },
    },
    {
      type: "toolCall",
      id: "patch-1",
      name: "patch",
      arguments: {
        operations: [
          {
            op: "block.update",
            moduleId: "research-agent",
            blockId: "research-root",
            payload: { fields: { ROLE: "植物课堂助手" } },
          },
        ],
      },
    },
    { type: "toolCall", id: "verify-1", name: "verify", arguments: {} },
  ],
  model: "test-model",
  requestId: "synthetic-response",
  transport: "local",
  provider: "fixture",
  usage: null,
};

it("runs a local inference transport and preserves missing vendor usage without claiming an external API", async () => {
  const result = await runBuilderEngine(createStarter(), request, {
    mode: "live",
    modelId: "qwen3-0.6b-q8-v1",
    generate: async () => ({
      ...structuredClone(response),
      schemaVersion: "blocky.model-response/v2",
      usageStatus: "unavailable",
      provider: "managed-local",
      localInference: true,
      externalApi: false,
    }),
  });
  expect(result.verification?.passed).toBe(true);
  expect(result.modelApiCalled).toBe(false);
  expect(result.generations[0].usage).toBeNull();
  expect(result.generations[0].usageStatus).toBe("unavailable");
});

it("executes genuine Pi tool dispatch through a custom transport with no file or shell tools", async () => {
  const project = createStarter(),
    before = JSON.stringify(project);
  const messages: unknown[] = [];
  const result = await runBuilderEngine(project, request, {
    mode: "deterministic",
    modelId: "test-model",
    generate: async (input) => {
      messages.push(input);
      return structuredClone(response);
    },
  });
  expect(result.patch?.operations).toHaveLength(1);
  expect(result.verification?.passed).toBe(true);
  expect(result.toolsUsed).toEqual(["draft", "patch", "verify"]);
  expect(result.modelApiCalled).toBe(false);
  expect(messages).toHaveLength(1);
  expect(JSON.stringify(project)).toBe(before);
});

it("refuses non-allowlisted tools and never treats a plain model explanation as a verified build", async () => {
  await expect(
    runBuilderEngine(createStarter(), request, {
      mode: "deterministic",
      modelId: "test-model",
      generate: async () => ({
        ...response,
        content: [
          {
            type: "toolCall",
            id: "evil",
            name: "bash",
            arguments: { command: "whoami" },
          },
        ],
      }),
    }),
  ).rejects.toThrow("BLK-BUILDER");
  await expect(
    runBuilderEngine(createStarter(), request, {
      mode: "deterministic",
      modelId: "test-model",
      generate: async () => ({
        ...response,
        content: [{ type: "text", text: "已完成" }],
      }),
    }),
  ).rejects.toThrow("BLK-BUILDER");
});

it("drops a transport response arriving after cancellation", async () => {
  const controller = new AbortController();
  await expect(
    runBuilderEngine(createStarter(), request, {
      mode: "deterministic",
      modelId: "test-model",
      signal: controller.signal,
      generate: async () => {
        controller.abort();
        return response;
      },
    }),
  ).rejects.toThrow();
});

it("verifies a completed candidate locally without buying an extra model turn", async () => {
  let calls = 0;
  const result = await runBuilderEngine(createStarter(), request, {
    mode: "deterministic",
    modelId: "test-model",
    generate: async () => {
      calls++;
      if (calls > 2) throw Error("BLK-BUILDER-BUDGET");
      return {
        ...response,
        content: [structuredClone(response.content[calls - 1])],
      };
    },
  });
  expect(calls).toBe(2);
  expect(result.toolsUsed).toEqual(["draft", "patch", "verify"]);
  expect(result.verification?.passed).toBe(true);
  expect(
    result.events.filter((e) => e.kind === "tool.completed").map((e) => e.tool),
  ).toEqual(["draft", "patch", "verify"]);
});
