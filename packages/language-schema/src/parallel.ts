import type { IrNode } from "./index";

const safeSteps = new Set([
  "core.data.set", "core.logic.condition", "core.flow.parallel", "core.flow.delay", "core.flow.fail",
]);

/** Parallel branches cannot mutate shared state or issue external requests. */
export function validateParallelNode(root: IrNode): void {
  let count = 0;
  const visit = (node: IrNode, depth: number, followNext = true): void => {
    if (!safeSteps.has(node.blockType)) throw Error("BLK-FLOW-001");
    if (++count > 2000) throw Error("BLK-FLOW-002");
    if (node.blockType === "core.flow.parallel") {
      if (++depth > 4) throw Error("BLK-FLOW-002");
      if (!node.inputs.LEFT || !node.inputs.RIGHT) throw Error("BLK-FLOW-001");
    }
    for (const child of Object.values(node.inputs)) {
      if (Array.isArray(child)) throw Error("BLK-FLOW-001");
      if (child) visit(child, depth);
    }
    if (followNext && node.next) visit(node.next, depth);
  };
  visit(root, 0, false);
}
