import { expect, it } from "vitest";
import { createCapabilityStarter, walkBlocks } from "../src";
import { applyDefaultModel } from "../../project-model/src";
import { compileProject } from "../../compiler/src";
import { createBuilderSession } from "../../builder-protocol/src";
import type { Resource } from "@blocky/language-schema";

it("requires a real tool-capable model and exposes tool declarations to the shared builder", async () => {
  const starter = createCapabilityStarter("tool-assistant", "starter-tools");
  expect(
    (await compileProject(starter)).diagnostics.map((d) => d.code),
  ).toContain("BLK-MODEL-TOOLS");
  const model: Resource = {
    ...starter.resources["agent-model"],
    resourceId: "configured-model",
    scope: "user",
    secretBindings: [{ fieldId: "apiKey", secretRef: "key-reference" }],
    definition: {
      provider: "deepseek",
      modelId: "deepseek-chat",
      protocol: "openai-chat",
      capabilities: ["text", "tools"],
      timeoutMs: 60000,
      implementationRef: { kind: "adapter", id: "deepseek-v1" },
    },
  };
  const registry = new Map([[model.resourceId, model]]);
  const project = applyDefaultModel(starter, model.resourceId, registry);
  expect((await compileProject(project, registry)).diagnostics).toEqual([]);
  expect(
    [...walkBlocks(project.workspaces["research-agent"].blocks.blocks)].find(
      (b) => b.type === "core.reason.tool_loop",
    )?.fields?.RESOURCE,
  ).toBe(model.resourceId);
  const session = await createBuilderSession(
    project,
    {
      schemaVersion: "blocky.builder-request/v1",
      requestId: "inspect-tools",
      projectId: project.manifest.projectId,
      intent: "explain",
      prompt: "检查工具办事助手的配置",
      moduleId: "research-agent",
      selection: [],
      createSurface: false,
    },
    { registry },
  );
  const result = session.inspect();
  expect(
    result.catalog.find((b) => b.type === "core.reason.tool_loop"),
  ).toMatchObject({ requiredInputs: ["TOOLS"] });
  expect(
    result.resources.find((r) => r.resourceId === model.resourceId),
  ).toMatchObject({ modelCapabilities: ["text", "tools"] });
  expect(
    result.resources.find((r) => r.resourceId === "text-tool"),
  ).toMatchObject({
    inputSchema: starter.schemas["schemas/text-input.json"],
    outputSchema: starter.schemas["schemas/text-result.json"],
  });
  expect(JSON.stringify(result)).not.toContain("key-reference");
});
