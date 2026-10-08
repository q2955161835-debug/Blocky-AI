import { expect, it } from "vitest";
import { compileProject } from "@blocky/compiler";
import type { Project, WorkspaceBlock } from "@blocky/language-schema";
import { Runtime } from "../src";

function reply(id: string, text: string): WorkspaceBlock {
  return { type: "core.message.reply", id, inputs: { MESSAGE: { block: {
    type: "core.message.create", id: `${id}-message`, inputs: { CONTENT: { block: {
      type: "core.data.literal", id: `${id}-text`, fields: { VALUE: text },
    } } },
  } } } };
}

function project(handler: WorkspaceBlock): Project {
  return {
    manifest: {
      schemaVersion: "blocky.project/v1", projectId: "flow-reply-project", displayName: "条件回复",
      modules: [{ moduleId: "main", displayName: "主画布", purpose: "rule", workspaceRef: "workspaces/main.workspace.json", exports: [] }],
      resources: [], appSurfaces: [], format: { createdWith: "blocky-desktop/0.8.0", minimumReaderVersion: "0.5.0" },
    },
    workspaces: { main: { blocks: { languageVersion: 0, blocks: [{
      type: "core.interaction.chat_entry", id: "entry", fields: { NAME: "条件回复" }, inputs: {
        CAPABILITIES: { block: { type: "core.interaction.accept_text", id: "accept" } },
        HANDLER: { block: handler },
      },
    }] } } }, resources: {}, schemas: {}, surfaces: {},
  };
}

it("compiles and runs three real repeated replies and an isolated ordinary branch", async () => {
  const fixture = project({ type: "core.logic.condition", id: "condition", fields: { SOURCE: "input", OP: "contains", VALUE: "重复" }, inputs: {
    THEN: { block: { type: "core.flow.repeat", id: "repeat", fields: { COUNT: "3" }, inputs: { DO: { block: reply("loop-reply", "积木运行正常") } } } },
    ELSE: { block: reply("ordinary-reply", "普通分支正常") },
  } });
  expect((await compileProject(fixture)).diagnostics).toEqual([]);
  const repeated = await new Runtime().run(fixture, "entry", "重复");
  expect(repeated.status).toBe("completed");
  expect(repeated.answer).toBe("积木运行正常".repeat(3));
  expect(repeated.events.filter(e => e.type === "block.completed" && e.blockId === "loop-reply")).toHaveLength(3);
  const ordinary = await new Runtime().run(fixture, "entry", "普通");
  expect(ordinary.status).toBe("completed");
  expect(ordinary.answer).toBe("普通分支正常");
  expect(ordinary.events.filter(e => e.type === "block.completed" && e.blockId === "ordinary-reply")).toHaveLength(1);
});

it.each([
  ["core.flow.repeat", { COUNT: "1" }, "DO"],
  ["core.flow.foreach", { SOURCE: "result", MAX_ITEMS: "3" }, "DO"],
  ["core.flow.while", { SOURCE: "input", OP: "truthy", MAX_ITERATIONS: "3" }, "DO"],
  ["core.flow.try", {}, "TRY"],
] as const)("allows a command in %s while rejecting values and tool declarations", async (type, fields, port) => {
  const control: WorkspaceBlock = { type, id: "control", fields: { ...fields }, inputs: { [port]: { block: reply("reply", "结果") } } };
  if (type === "core.flow.try") control.inputs!.CATCH = { block: reply("fallback", "失败") };
  expect((await compileProject(project(control))).diagnostics).toEqual([]);
  const invalidChildren: WorkspaceBlock[] = [
    { type: "core.data.literal", id: "value", fields: { VALUE: "错误插槽" } },
    { type: "core.tool.expose", id: "tool", fields: { RESOURCE: "missing" } },
  ];
  for (const child of invalidChildren) {
    control.inputs![port] = { block: child };
    expect((await compileProject(project(control))).diagnostics.map(d => d.code)).toContain("BLK-TYPE-009");
  }
});

it("continues to reject retrying replies with observable side effects", async () => {
  const fixture = project({ type: "core.flow.retry", id: "retry", fields: { ATTEMPTS: "2", WAIT_MS: "0" }, inputs: { DO: { block: reply("reply", "不能重放") } } });
  expect((await compileProject(fixture)).diagnostics.map(d => d.code)).toContain("BLK-FLOW-RETRY-UNSAFE");
});
