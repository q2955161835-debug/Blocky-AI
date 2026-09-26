import type { IrNode } from "@blocky/language-schema";

/** Resolve the same input boundary for execution, debugging and persisted continuation. */
export function resolveRunEntry(root: IrNode, interactionId: string) {
  const selectedEntry = findEntry(root, interactionId);
  if (!selectedEntry) return undefined;
  const handler =
    selectedEntry === root &&
    selectedEntry.blockType === "core.interaction.chat_entry"
      ? selectedEntry.inputs.HANDLER
      : undefined;
  const handlerHead = handler && !Array.isArray(handler) ? handler : undefined;
  return {
    selectedEntry,
    handlerHead,
    workflowRoot: handlerHead ?? selectedEntry.next,
  };
}
function findEntry(node: IrNode, id: string): IrNode | undefined {
  if (node.nodeId === id) return node;
  for (const value of Object.values(node.inputs)) {
    for (const child of value ? (Array.isArray(value) ? value : [value]) : []) {
      const found = findEntry(child, id);
      if (found) return found;
    }
  }
  return node.next ? findEntry(node.next, id) : undefined;
}
