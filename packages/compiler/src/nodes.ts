import type { IrNode } from "@blocky/language-schema";
export function* walkNodes(
  roots: IrNode[],
): Generator<{ node: IrNode; owner?: string }> {
  function* walk(
    node: IrNode,
    owner?: string,
  ): Generator<{ node: IrNode; owner?: string }> {
    if (node.blockType === "core.agent") owner = node.nodeId;
    yield { node, owner };
    for (const value of Object.values(node.inputs))
      for (const n of value ? (Array.isArray(value) ? value : [value]) : [])
        yield* walk(n, owner);
    if (node.next) yield* walk(node.next, owner);
  }
  for (const root of roots) yield* walk(root);
}
