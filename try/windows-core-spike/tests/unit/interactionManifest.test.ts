import { describe, expect, it } from "vitest";
import { compileWorkspace } from "../../src/core/compileWorkspace";
import { compileInteractionManifest } from "../../src/core/interactionManifest";
import type { BlockyProgram, IrNode } from "../../src/core/ir";

function node(
  id: string,
  type: string,
  options: Partial<Pick<IrNode, "fields" | "inputs" | "next">> = {},
): IrNode {
  return { id, type, fields: {}, inputs: {}, next: null, ...options };
}

function chain(...nodes: IrNode[]): IrNode {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    nodes[index].next = nodes[index + 1];
  }
  return nodes[0];
}

function program(...roots: IrNode[]): BlockyProgram {
  return { schemaVersion: "blocky.ir/v0-spike", roots };
}

function handler(id: string): IrNode {
  return node(id, "core.message.send");
}

function entry(
  id: string,
  name: string,
  capabilities: IrNode | undefined = undefined,
  handlerNode: IrNode | undefined = handler(`${id}-handler`),
): IrNode {
  const inputs: Record<string, IrNode | null> = {};
  if (capabilities) inputs.CAPABILITIES = capabilities;
  if (handlerNode) inputs.HANDLER = handlerNode;
  return node(id, "core.interaction.chat_entry", {
    fields: { NAME: name },
    inputs,
  });
}

function agent(id: string, members: IrNode): IrNode {
  return node(id, "core.agent.define", { inputs: { MEMBERS: members } });
}

describe("interaction manifest compiler", () => {
  it("returns a frozen empty manifest when the IR has no chat entries", () => {
    const result = compileInteractionManifest(program(node("event", "core.event.manual_run")));

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual({ schemaVersion: "blocky.interaction/v0-spike", entries: [] });
    expect(Object.isFrozen(result.manifest)).toBe(true);
    expect(Object.isFrozen(result.manifest.entries)).toBe(true);
  });

  it("uses stable entry and agent IDs while defaulting blank names in semantic member order", () => {
    const result = compileInteractionManifest(program(agent("agent-stable", chain(
      entry("entry-stable-a", ""),
      entry("entry-stable-b", "客户支持"),
    ))));

    expect(result.manifest.entries.map((item) => item.displayName)).toEqual(["输入 1", "客户支持"]);
    expect(result.manifest.entries.map((item) => item.id)).toEqual(["entry-stable-a", "entry-stable-b"]);
    expect(result.manifest.entries.map((item) => item.ownerAgentId)).toEqual(["agent-stable", "agent-stable"]);
    expect(Object.isFrozen(result.manifest.entries[0])).toBe(true);
  });

  it("keeps route IDs when entries are renamed and reordered", () => {
    const first = compileInteractionManifest(program(agent("agent-stable", chain(
      entry("entry-stable-a", "收件箱"),
      entry("entry-stable-b", "客户支持"),
    ))));
    const renamedAndReordered = compileInteractionManifest(program(agent("agent-stable", chain(
      entry("entry-stable-b", "帮助中心"),
      entry("entry-stable-a", "主输入"),
    ))));

    expect(first.manifest.entries.map((item) => item.id)).toEqual(["entry-stable-a", "entry-stable-b"]);
    expect(renamedAndReordered.manifest.entries.map((item) => item.id)).toEqual(["entry-stable-b", "entry-stable-a"]);
    expect(renamedAndReordered.manifest.entries.map((item) => item.displayName)).toEqual(["帮助中心", "主输入"]);
  });

  it("derives fixed part order and only explicit capability exposure IDs", () => {
    const internalTool = node("internal-tool", "core.agent.add_tool", {
      inputs: { TOOL: node("tool-reference", "core.tool.reference", { fields: { TOOL_ID: "tool.internal" } }) },
    });
    const onlyText = entry("entry-isolated", "隔离", node("accept-text", "core.interaction.accept_text"));
    const isolated = compileInteractionManifest(program(agent("agent-isolated", chain(onlyText, internalTool))));

    expect(isolated.manifest.entries[0].acceptedParts).toEqual(["text"]);
    expect(isolated.manifest.entries[0].exposedSkills).toEqual([]);
    expect(isolated.manifest.entries[0].exposedPluginActions).toEqual([]);

    const capabilities = chain(
      node("voice", "core.interaction.accept_voice"),
      node("plugin-z", "core.interaction.expose_plugin", { fields: { PLUGIN: "plugin.z" } }),
      node("image", "core.interaction.accept_image"),
      node("skill-b", "core.interaction.expose_skill", { fields: { SKILL: "skill.b" } }),
      node("file", "core.interaction.accept_file"),
      node("text", "core.interaction.accept_text"),
      node("skill-a", "core.interaction.expose_skill", { fields: { SKILL: "skill.a" } }),
      node("plugin-a", "core.interaction.expose_plugin", { fields: { PLUGIN: "plugin.a" } }),
      node("skill-a-duplicate", "core.interaction.expose_skill", { fields: { SKILL: "skill.a" } }),
    );
    const exposed = compileInteractionManifest(program(agent("agent-exposed", entry("entry-exposed", "公开", capabilities))));

    expect(exposed.manifest.entries[0].acceptedParts).toEqual(["text", "image", "file", "voice"]);
    expect(exposed.manifest.entries[0].exposedSkills).toEqual(["skill.a", "skill.b"]);
    expect(exposed.manifest.entries[0].exposedPluginActions).toEqual(["plugin.a", "plugin.z"]);
  });

  it("blocks orphan entries and entries without a handler using Chinese diagnostics", () => {
    const result = compileInteractionManifest(program(
      entry("orphan-entry", "孤立", undefined, handler("orphan-handler")),
      agent("agent-empty", node("empty-entry", "core.interaction.chat_entry", { fields: { NAME: "空处理器" } })),
    ));

    expect(result.manifest.entries).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "INTERACTION_ORPHAN_ENTRY",
      severity: "error",
      blockId: "orphan-entry",
      message: expect.stringMatching(/[\u4e00-\u9fff]/),
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "INTERACTION_EMPTY_HANDLER",
      severity: "error",
      blockId: "empty-entry",
      message: expect.stringMatching(/[\u4e00-\u9fff]/),
    }));
  });

  it("warns on duplicate display names without changing their stable route IDs", () => {
    const result = compileInteractionManifest(program(agent("agent-duplicate-names", chain(
      entry("entry-first", "同名"),
      entry("entry-second", "同名"),
    ))));

    expect(result.manifest.entries.map((item) => item.id)).toEqual(["entry-first", "entry-second"]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "INTERACTION_DUPLICATE_DISPLAY_NAME",
      severity: "warning",
      blockId: "entry-second",
    }));
  });

  it("keeps duplicate stable IDs blocking at the IR boundary instead of inventing manifest routes", () => {
    const ir = compileWorkspace({
      blocks: {
        blocks: [
          { id: "duplicate-entry", type: "core.interaction.chat_entry" },
          { id: "duplicate-entry", type: "core.interaction.chat_entry" },
        ],
      },
    });
    const manifest = compileInteractionManifest(ir.program);

    expect(ir.diagnostics).toContainEqual(expect.objectContaining({
      code: "IR_DUPLICATE_BLOCK_ID",
      severity: "error",
      blockId: "duplicate-entry",
    }));
    expect(ir.program.roots).toEqual([]);
    expect(manifest.manifest.entries).toEqual([]);
    expect(manifest.diagnostics).not.toContainEqual(expect.objectContaining({ code: "IR_DUPLICATE_BLOCK_ID" }));
  });
});
