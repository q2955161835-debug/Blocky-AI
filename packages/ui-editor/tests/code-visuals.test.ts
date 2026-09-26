// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { Blockly, registerBlocks } from "../src/blocks";
import { applyCodeVisuals } from "../src/canvas/code-visuals";
import type { Workspace } from "@blocky/language-schema";

it("projects four persistent code badges without serializing the presentation", () => {
  registerBlocks();
  const workspace = new Blockly.Workspace();
  const program = { schemaVersion: "blocky.expression/v1", parameters: ["x"], expression: { parameter: "x" } };
  const source: Workspace = { blocks: { languageVersion: 0, blocks: [
    { type: "core.data.transform", id: "official", fields: { PROGRAM: program, SOURCE: null } },
    { type: "core.data.transform", id: "custom", fields: { PROGRAM: program }, data: '{"schemaVersion":"blocky.editor/v1","codeEdited":true}' },
    { type: "core.data.transform", id: "warning", fields: { PROGRAM: program, SOURCE: "legacy" } },
    { type: "core.data.transform", id: "invalid", fields: { PROGRAM: { schemaVersion: "invalid" } } },
  ] } };
  try {
    Blockly.serialization.workspaces.load(source, workspace);
    const before = Blockly.serialization.workspaces.save(workspace);
    applyCodeVisuals(workspace, source);
    for (const [id, label] of [["official", "✓ 官方默认"], ["custom", "✓ 已自定义"], ["warning", "⚠ 代码警告"], ["invalid", "✖ 代码无效"]])
      expect(workspace.getBlockById(id)?.getFieldValue("BLOCKY_CODE_STATE")).toBe(label);
    expect(Blockly.serialization.workspaces.save(workspace)).toEqual(before);
  } finally { workspace.dispose(); }
});

it("refreshes accessible descriptions of rendered code and its containing blocks", () => {
  registerBlocks();
  // jsdom has no font layout; this test exercises real Blockly SVG/ARIA projection.
  const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const workspace = Blockly.inject(container, { toolbox: undefined, sounds: false });
  const program = { schemaVersion: "blocky.expression/v1", parameters: ["x"], expression: { parameter: "x" } };
  const code = { type: "core.data.transform", id: "code", fields: { PROGRAM: program, SOURCE: null } };
  const source: Workspace = { blocks: { languageVersion: 0, blocks: [{
    type: "core.tool.entry", id: "entry", inputs: { BODY: { block: {
      type: "core.message.reply", id: "reply", inputs: { MESSAGE: { block: {
        type: "core.message.create", id: "message", inputs: { CONTENT: { block: code } },
      } } },
    } } },
  }] } };
  try {
    Blockly.serialization.workspaces.load(source, workspace);
    const described = workspace.getAllBlocks(false).filter(block =>
      block.getFocusableElement().getAttribute("aria-label")?.includes("代码无效"));
    expect(described.length).toBeGreaterThan(1);
    const before = Blockly.serialization.workspaces.save(workspace);
    const focused = document.activeElement;
    for (const [label, updated] of [
      ["✓ 官方默认", code],
      ["✓ 已自定义", { ...code, data: '{"schemaVersion":"blocky.editor/v1","codeEdited":true}' }],
      ["⚠ 代码警告", { ...code, fields: { ...code.fields, SOURCE: "legacy" } }],
      ["✖ 代码无效", { ...code, fields: { PROGRAM: { schemaVersion: "invalid" } } }],
    ] as const) {
      const next = structuredClone(source);
      next.blocks.blocks[0].inputs!.BODY.block!.inputs!.MESSAGE.block!.inputs!.CONTENT.block = updated;
      applyCodeVisuals(workspace, next);
      expect(workspace.getBlockById("code")!.getFieldValue("BLOCKY_CODE_STATE")).toBe(label);
      for (const block of described)
        expect(block.getFocusableElement().getAttribute("aria-label")).toContain(label);
      expect(document.activeElement).toBe(focused);
    }
    expect(Blockly.serialization.workspaces.save(workspace)).toEqual(before);
  } finally {
    workspace.dispose(); container.remove(); context.mockRestore();
  }
});
