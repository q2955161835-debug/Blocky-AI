import * as Blockly from "blockly/core";
import { afterEach, describe, expect, it } from "vitest";
import { registerSpikeBlocks } from "../../src/blockly/definitions";
import {
  countSerializedBlocks,
  createHundredBlockWorkspaceState,
} from "../../src/blockly/fixtures";
import {
  listWorkspaceBlockIds,
  loadWorkspace,
  saveWorkspace,
} from "../../src/blockly/workspaceAdapter";

describe("100-block fixture", () => {
  const workspaces: Blockly.Workspace[] = [];

  afterEach(() => {
    for (const workspace of workspaces) workspace.dispose();
  });

  it("loads exactly 100 locally registered blocks", () => {
    registerSpikeBlocks();
    const state = createHundredBlockWorkspaceState();
    expect(countSerializedBlocks(state)).toBe(100);

    const workspace = new Blockly.Workspace();
    workspaces.push(workspace);
    Blockly.serialization.workspaces.load(state, workspace);
    const blocks = workspace.getAllBlocks(false);
    expect(blocks).toHaveLength(100);
    expect(new Set(blocks.map((block) => block.id)).size).toBe(100);
    expect(blocks.map((block) => block.id).sort()).toEqual(
      Array.from({ length: 100 }, (_, index) =>
        `block-${String(index + 1).padStart(3, "0")}`,
      ),
    );
    expect(blocks.every((block) => Boolean(Blockly.Blocks[block.type]))).toBe(true);
  });

  it("assigns stable unique coordinates to every top-level stack", () => {
    const first = createHundredBlockWorkspaceState() as {
      blocks: { blocks: Array<{ id: string; x?: number; y?: number }> };
    };
    const second = createHundredBlockWorkspaceState();
    const roots = first.blocks.blocks;

    expect(roots.every((root) =>
      Number.isFinite(root.x) && Number.isFinite(root.y)
    )).toBe(true);
    expect(roots.every((root) => (root.y ?? 0) >= 96)).toBe(true);
    expect(new Set(roots.map((root) => `${root.x}:${root.y}`)).size)
      .toBe(roots.length);
    expect(second).toEqual(first);
  });

  it("keeps the actual Blockly traversal and root-block order on reload", () => {
    registerSpikeBlocks();
    const original = new Blockly.Workspace();
    const reloaded = new Blockly.Workspace();
    workspaces.push(original, reloaded);
    loadWorkspace(createHundredBlockWorkspaceState(), original);
    original.getBlockById("block-001")?.setCollapsed(true);

    const originalTraversal = original.getAllBlocks(false).map((block) => block.id);
    const originalRootOrder = (saveWorkspace(original) as {
      blocks: { blocks: Array<{ id: string }> };
    }).blocks.blocks.map((block) => block.id);

    expect(listWorkspaceBlockIds(original)).toEqual(originalTraversal);
    loadWorkspace(saveWorkspace(original), reloaded);
    expect(listWorkspaceBlockIds(reloaded)).toEqual(originalTraversal);
    expect(
      (saveWorkspace(reloaded) as { blocks: { blocks: Array<{ id: string }> } }).blocks.blocks.map(
        (block) => block.id,
      ),
    ).toEqual(originalRootOrder);
    expect(reloaded.getBlockById("block-001")?.isCollapsed()).toBe(true);
  });

  it("round-trips the official Blockly serialization", () => {
    registerSpikeBlocks();
    const original = new Blockly.Workspace();
    const reloaded = new Blockly.Workspace();
    workspaces.push(original, reloaded);
    loadWorkspace(createHundredBlockWorkspaceState(), original);
    original.getBlockById("block-001")?.setCollapsed(true);

    loadWorkspace(saveWorkspace(original), reloaded);

    expect(listWorkspaceBlockIds(reloaded)).toEqual(listWorkspaceBlockIds(original));
    expect(reloaded.getAllBlocks(false)).toHaveLength(100);
    expect(reloaded.getBlockById("block-001")?.isCollapsed()).toBe(true);
  });
});
