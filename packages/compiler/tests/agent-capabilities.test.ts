import { expect, it } from "vitest";
import type { WorkspaceBlock } from "@blocky/language-schema";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import { compileProject } from "../src";

function findBlock(
  root: WorkspaceBlock,
  id: string,
): WorkspaceBlock | undefined {
  if (root.id === id) return root;
  for (const input of Object.values(root.inputs ?? {})) {
    const child = input.block ?? input.shadow;
    if (child) {
      const found = findBlock(child, id);
      if (found) return found;
    }
  }
  return root.next?.block ? findBlock(root.next.block, id) : undefined;
}

function expose(id: string, resource = "text-tool"): WorkspaceBlock {
  return { type: "core.tool.expose", id, fields: { RESOURCE: resource } };
}

function toolLoop() {
  const project = createAgentExample("tool-loop-project");
  const workspace = project.workspaces["research-agent"];
  const loop = findBlock(workspace.blocks.blocks[0], "analyze-text")!;
  loop.type = "core.reason.tool_loop";
  loop.fields = {
    RESOURCE: "agent-model",
    MAX_TURNS: "3",
    OUTPUT_TOKENS: "256",
  };
  loop.inputs = { TOOLS: { block: expose("expose-text") } };
  project.resources["agent-model"].definition.capabilities = ["text", "tools"];
  return { project, loop };
}

it("compiles tool-loop declarations into typed contracts and permission dependencies", async () => {
  const { project } = toolLoop();
  const result = await compileProject(project);
  expect(result.diagnostics).toEqual([]);
  expect(result.tools).toContainEqual(
    expect.objectContaining({
      toolId: "tool-research-agent-expose-text",
      permissions: ["text.analyze"],
      inputSchemaRef: "schemas/text-input.json",
      outputSchemaRef: "schemas/text-result.json",
      implementationRef: "adapter://text-analyze-v1",
      approval: "always",
    }),
  );
});

it("requires a tools-capable model, one to sixteen distinct tools, and TOOLS-only declarations", async () => {
  const invalidBounds = toolLoop();
  invalidBounds.loop.fields!.MAX_TURNS = "9";
  expect(
    (await compileProject(invalidBounds.project)).diagnostics.map(
      (d) => d.code,
    ),
  ).toContain("BLK-TOOL-LOOP-CONFIG");

  const missingCapability = toolLoop();
  missingCapability.project.resources["agent-model"].definition.capabilities = [
    "text",
  ];
  expect(
    (await compileProject(missingCapability.project)).diagnostics.map(
      (d) => d.code,
    ),
  ).toContain("BLK-MODEL-TOOLS");

  const duplicate = toolLoop();
  duplicate.loop.inputs!.TOOLS!.block!.next = {
    block: expose("expose-duplicate"),
  };
  expect(
    (await compileProject(duplicate.project)).diagnostics.map((d) => d.code),
  ).toContain("BLK-TOOL-LOOP-CONFIG");

  const invalidTool = toolLoop();
  invalidTool.loop.inputs!.TOOLS!.block!.fields!.RESOURCE = "agent-model";
  expect(
    (await compileProject(invalidTool.project)).diagnostics.map((d) => d.code),
  ).toContain("BLK-RESOURCE-001");

  const orphan = createAgentExample("orphan-tool-project");
  const invoke = findBlock(
    orphan.workspaces["research-agent"].blocks.blocks[0],
    "analyze-text",
  )!;
  invoke.type = "core.tool.expose";
  invoke.fields = { RESOURCE: "text-tool" };
  expect(
    (await compileProject(orphan)).diagnostics.map((d) => d.code),
  ).toContain("BLK-TOOL-LOOP-SCOPE");
});

it("allows a zero-tool Pi loop while retaining the Blocky minimum", async () => {
  const pi = toolLoop();
  pi.loop.fields!.ENGINE = "pi";
  pi.loop.inputs = {};
  expect((await compileProject(pi.project)).diagnostics).toEqual([]);

  const blocky = toolLoop();
  blocky.loop.fields!.ENGINE = "blocky";
  blocky.loop.inputs = {};
  expect(
    (await compileProject(blocky.project)).diagnostics.map((item) => item.code),
  ).toContain("BLK-TOOL-LOOP-CONFIG");
});

it("validates bounded flow configuration and rejects retrying effectful tools", async () => {
  const repeat = createAgentExample("bounded-repeat-project");
  const repeated = findBlock(
    repeat.workspaces["research-agent"].blocks.blocks[0],
    "analyze-text",
  )!;
  repeated.type = "core.flow.repeat";
  repeated.fields = { COUNT: "101" };
  repeated.inputs = {
    DO: {
      block: {
        type: "core.data.set",
        id: "set-in-repeat",
        fields: { VALUE: "1" },
      },
    },
  };
  expect(
    (await compileProject(repeat)).diagnostics.map((d) => d.code),
  ).toContain("BLK-FLOW-CONFIG");

  const retry = createAgentExample("unsafe-retry-project");
  const retried = findBlock(
    retry.workspaces["research-agent"].blocks.blocks[0],
    "analyze-text",
  )!;
  retried.type = "core.flow.retry";
  retried.fields = { ATTEMPTS: "2", WAIT_MS: "0" };
  retried.inputs = {
    DO: {
      block: {
        type: "core.tool.invoke",
        id: "effect-in-retry",
        fields: { RESOURCE: "text-tool", SOURCE: "input" },
      },
    },
  };
  expect(
    (await compileProject(retry)).diagnostics.map((d) => d.code),
  ).toContain("BLK-FLOW-RETRY-UNSAFE");
});
