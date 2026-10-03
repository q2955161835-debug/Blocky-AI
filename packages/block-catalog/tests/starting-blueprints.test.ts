import { expect, it } from "vitest";
import {
  createStartingBlueprint,
  startingBlueprints,
  walkBlocks,
  workspaceToolDefinitions,
} from "../src";
import { compileProject } from "../../compiler/src";
import { decodeProject, encodeProject } from "../../project-format/src";

function blocks(project: ReturnType<typeof createStartingBlueprint>) {
  return [...walkBlocks(project.workspaces.main.blocks.blocks)];
}

function toolLoop(project: ReturnType<typeof createStartingBlueprint>) {
  const loop = blocks(project).find(
    (block) => block.type === "core.reason.tool_loop",
  );
  expect(loop).toBeDefined();
  return loop!;
}

it("registers exactly four project starting blueprints in the approved order", () => {
  expect(startingBlueprints.map(({ id, displayName }) => [id, displayName])).toEqual([
    ["knowledge-assistant", "知识问答助手"],
    ["work-assistant", "工作助手"],
    ["coding-assistant", "Coding 助手"],
    ["pi-agent", "Pi Agent"],
  ]);
  for (const blueprint of startingBlueprints) {
    const project = createStartingBlueprint(blueprint.id, `project-${blueprint.id}`);
    expect(project.manifest.displayName).toBe(blueprint.displayName);
    expect(project.manifest.modules.map((module) => module.moduleId)).toEqual([
      "main",
    ]);
    expect(project.manifest.appSurfaces).toEqual([]);
    expect(project.workspaces.main.blocks.blocks[0].type).toBe("core.agent");
  }
  expect(() => createStartingBlueprint("old-research-companion")).toThrow(
    "BLK-STARTING-BLUEPRINT-001",
  );
});

it("starts knowledge Q&A with the knowledge-core resource and no seeded answers or documents", async () => {
  const project = createStartingBlueprint("knowledge-assistant", "knowledge-start");
  const retrieve = blocks(project).find(
    (block) => block.type === "core.knowledge.retrieve",
  );
  expect(retrieve?.fields?.RESOURCE).toBe("assistant-knowledge");
  expect(
    blocks(project).find((block) => block.type === "core.guardrail.evidence")
      ?.fields?.POLICY,
  ).toBe("require");
  const knowledge = project.resources["assistant-knowledge"];
  expect(knowledge).toMatchObject({
    kind: "knowledge",
    definition: {
      collection: "assistant-knowledge",
      implementationRef: { kind: "adapter", id: "knowledge-local-v1" },
      sourceRef: { kind: "resource", id: "assistant-knowledge" },
      retrieval: { strategy: "keyword", topK: 5 },
    },
  });
  expect(project.resources["assistant-model"]).toBeUndefined();
  expect(project.schemas).toEqual({});
  expect(JSON.stringify(project)).not.toContain("示例答案");
  const { diagnostics } = await compileProject(project);
  expect(diagnostics.map(({ code }) => code)).toEqual(["BLK-RESOURCE-001"]);
});

it.each([
  {
    id: "work-assistant",
    operations: ["list", "search", "read", "write", "undo"],
  },
  {
    id: "coding-assistant",
    operations: ["list", "search", "read", "write", "undo", "check"],
  },
])("declares shared, scoped workspace tools for $id", async ({ id, operations }) => {
  const project = createStartingBlueprint(id, `${id}-project`);
  const loop = toolLoop(project);
  expect(loop.fields).toMatchObject({
    RESOURCE: "assistant-model",
    ENGINE: "pi",
    SESSION: "conversation",
    MAX_TURNS: "8",
    OUTPUT_TOKENS: "512",
  });
  const budget = blocks(project).find((block) => block.type === "core.run.budget");
  expect(budget?.fields).toMatchObject({ CALLS: "16", OUTPUT_TOKENS: "4096" });
  const declared = [...walkBlocks([loop.inputs!.TOOLS!.block!])];
  const toolResources = declared.map(
    (block) => project.resources[String(block.fields?.RESOURCE)],
  );
  expect(toolResources.map((resource) => resource.definition.operation)).toEqual(
    operations,
  );
  expect(toolResources).toHaveLength(operations.length);
  expect(toolResources).toEqual(
    operations.map((operation) => {
      const definition = workspaceToolDefinitions.find(
        (entry) => entry.operation === operation,
      )!;
      return expect.objectContaining({
        kind: "tool",
        resourceId: `workspace-${operation}`,
        capabilityRequirements: [definition.permission],
        definition: expect.objectContaining({
          operation,
          permissions: [definition.permission],
          implementationRef: { kind: "adapter", id: "workspace-file-v1" },
          inputSchemaRef: {
            kind: "schema",
            id: `workspace-${operation}-input`,
          },
        }),
      });
    }),
  );
  expect(toolResources.map((resource) => resource.resourceId)).toEqual(
    operations.map((operation) => `workspace-${operation}`),
  );
  for (const resource of toolResources) {
    const operation = operations.find(
      (candidate) => `workspace-${candidate}` === resource.resourceId,
    )!;
    const definition = workspaceToolDefinitions.find(
      (entry) => entry.operation === operation,
    )!;
    expect(project.schemas[`schemas/workspace-${operation}-input.json`]).toEqual(
      definition.input,
    );
  }
  expect(JSON.stringify(project)).not.toMatch(/[A-Z]:\\/);
  expect(JSON.stringify(project)).not.toMatch(/(?:api[_-]?key|authorization|bearer)/i);
  const { diagnostics } = await compileProject(project);
  expect(diagnostics.map(({ code }) => code)).toEqual(["BLK-RESOURCE-001"]);
});

it("uses the Pi engine with conversation scope and permits an empty tool declaration", async () => {
  const project = createStartingBlueprint("pi-agent", "pi-project");
  const loop = toolLoop(project);
  expect(loop.fields).toMatchObject({
    RESOURCE: "assistant-model",
    ENGINE: "pi",
    SESSION: "conversation",
  });
  expect(loop.inputs?.TOOLS).toBeUndefined();
  expect(
    project.manifest.resources.filter((resource) => resource.kind === "tool"),
  ).toEqual([]);
  const { diagnostics } = await compileProject(project);
  expect(diagnostics.map(({ code }) => code)).toEqual(["BLK-RESOURCE-001"]);
});

it("round-trips ordinary edits to a starting project without persisting local grants", () => {
  const project = createStartingBlueprint("work-assistant", "work-round-trip");
  const root = project.workspaces.main.blocks.blocks[0];
  root.fields!.ROLE = "按用户指定的会议纪要格式整理资料。";
  const reopened = decodeProject(encodeProject(project));
  expect(reopened.workspaces.main.blocks.blocks[0].fields?.ROLE).toBe(
    "按用户指定的会议纪要格式整理资料。",
  );
  expect(JSON.stringify(reopened)).not.toContain("workspaceRoot");
  expect(JSON.stringify(reopened)).not.toMatch(/[A-Z]:\\/);
});
