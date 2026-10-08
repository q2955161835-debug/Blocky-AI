import { Blockly } from "../blocks";
type DragBlock = {
  isDragging(): boolean;
  getParent(): { isDragging(): boolean } | null;
  revertDrag(): void;
};
type DragWorkspace = {
  getAllBlocks(ordered: boolean): DragBlock[];
  cancelCurrentGesture(): void;
};

export function hasNativeBlockDrag(workspace: DragWorkspace) {
  return workspace.getAllBlocks(false).some(block => block.isDragging());
}

/** Blockly cancel ends at the current position; revert first to truly cancel. */
export function cancelNativeBlockDrag(workspace: DragWorkspace) {
  const roots = workspace.getAllBlocks(false).filter(block => block.isDragging() && !block.getParent()?.isDragging());
  Blockly.Events.disable();
  try {
    for (const block of roots) block.revertDrag();
    workspace.cancelCurrentGesture();
  } finally {
    Blockly.Events.enable();
  }
}
