// @vitest-environment jsdom
import { expect, it } from "vitest";
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
