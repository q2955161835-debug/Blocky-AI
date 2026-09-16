import { expect, it } from "vitest";
import { Blockly, registerBlocks } from "../src/blocks";
import { createStarter } from "../../test-fixtures/src/index";
import { captureBlueprint, instantiateBlueprint, defaultBindings } from "../../block-catalog/src";
import type { Workspace } from "../../language-schema/src";
it("preserves folded real Blockly stacks through blueprint insertion and expansion", async () => {
  registerBlocks();
  const project = createStarter(), workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(project.workspaces["research-agent"], workspace);
    workspace.getBlockById("research-root")!.setCollapsed(true);
    project.workspaces["research-agent"] = Blockly.serialization.workspaces.save(workspace) as Workspace;
    const blueprint = await captureBlueprint(project, "research-agent", ["research-root"], "折叠问答");
    const roots = await instantiateBlueprint(blueprint, project, "research-agent", defaultBindings(blueprint));
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: roots } }, workspace);
    expect(workspace.getAllBlocks(false)).toHaveLength(5);
    const inserted = workspace.getBlockById(roots[0].id)!;
    inserted.setCollapsed(false); inserted.setFieldValue("教师", "ROLE");
    expect(inserted.getFieldValue("ROLE")).toBe("教师");
  } finally { workspace.dispose(); }
});
it("loads and serializes real Blockly blocks with editable role and stable IDs", () => {
  registerBlocks();
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      createStarter().workspaces["research-agent"],
      workspace,
    );
    const root = workspace.getBlockById("research-root")!;
    expect(root.type).toBe("core.agent");
    root.setFieldValue("教师", "ROLE");
    const saved = Blockly.serialization.workspaces.save(workspace);
    expect(JSON.stringify(saved)).toContain("教师");
    expect(workspace.getAllBlocks(false)).toHaveLength(5);
  } finally {
    workspace.dispose();
  }
});
