import { expect, it } from "vitest";
import { Blockly, registerBlocks } from "../src/blocks";
import { createStarter } from "../../test-fixtures/src/index";
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
