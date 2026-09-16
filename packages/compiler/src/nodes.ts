import type { IrNode } from "@blocky/language-schema";
export function* walkNodes(
  roots: IrNode[],
): Generator<{ node: IrNode; owner?: string }> {
  function* walk(
    node: IrNode,
    owner?: string,
  ): Generator<{ node: IrNode; owner?: string }> {
    if (["core.agent", "core.agent.define"].includes(node.blockType))
      owner = node.nodeId;
    yield { node, owner };
    for (const value of Object.values(node.inputs))
      for (const n of value ? (Array.isArray(value) ? value : [value]) : [])
        yield* walk(n, owner);
    if (node.next) yield* walk(node.next, owner);
  }
  for (const root of roots) yield* walk(root);
}
