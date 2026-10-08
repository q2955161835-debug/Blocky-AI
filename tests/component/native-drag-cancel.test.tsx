// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { Blockly } from "../../packages/ui-editor/src/blocks";
import { cancelNativeBlockDrag, hasNativeBlockDrag } from "../../packages/ui-editor/src/canvas/nativeBlockDrag";

it("reverts the dragged stack before ending Blockly's commit-on-cancel gesture, without reverting its children twice", () => {
  let position = { x: 133, y: 99 }, dragging = true, saved = { x: 80, y: 70 }, edits = 0;
  const order: string[] = [];
  const publish = () => {
    if (!Blockly.Events.isEnabled() || hasNativeBlockDrag(workspace)) return;
    if (JSON.stringify(position) !== JSON.stringify(saved)) { saved = { ...position }; edits++; }
  };
  const parent = { isDragging: () => false, getParent: () => null, revertDrag: vi.fn() };
  const root = { isDragging: () => dragging, getParent: () => parent, revertDrag: vi.fn(() => { order.push("revert"); expect(Blockly.Events.isEnabled()).toBe(false); position = { x: 80, y: 70 }; dragging = false; }) };
  const child = { isDragging: () => dragging, getParent: () => root, revertDrag: vi.fn() };
  const workspace = { getAllBlocks: () => [parent, root, child], cancelCurrentGesture: () => { order.push("end"); publish(); } };
  publish(); expect(edits).toBe(0);
  cancelNativeBlockDrag(workspace);
  publish(); // A previously queued unplug/move event arrives after cancellation.
  expect(position).toEqual({ x: 80, y: 70 }); expect(saved).toEqual(position); expect(edits).toBe(0);
  expect(order).toEqual(["revert", "end"]); expect(child.revertDrag).not.toHaveBeenCalled(); expect(parent.revertDrag).not.toHaveBeenCalled();
  expect(Blockly.Events.isEnabled()).toBe(true);
});

it("retains normal drag completion and restores event state even if cancellation fails", () => {
  let dragging = true;
  const root = { isDragging: () => dragging, getParent: () => null, revertDrag: vi.fn() };
  const workspace = { getAllBlocks: () => [root], cancelCurrentGesture: vi.fn(() => { throw Error("failed"); }) };
  expect(hasNativeBlockDrag(workspace)).toBe(true);
  dragging = false; expect(hasNativeBlockDrag(workspace)).toBe(false);
  expect(() => cancelNativeBlockDrag(workspace)).toThrow("failed");
  expect(root.revertDrag).not.toHaveBeenCalled(); expect(Blockly.Events.isEnabled()).toBe(true);
});
