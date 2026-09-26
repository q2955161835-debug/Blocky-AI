import type { IrNode } from "./index";
export const isWorkflowMarker = (type: string) =>
  [
    "runtime.compensate",
    "core.human.approve",
    "runtime.checkpoint.save",
  ].includes(type);
export type WorkflowLayoutStep =
  | {
      stepId: string;
      kind: "action";
      compensate: boolean;
      body: IrNode;
      undo?: IrNode;
    }
  | { stepId: string; kind: "approval"; label: string }
  | { stepId: string; kind: "checkpoint" };
/** Explicit top-level durable boundaries. Child stacks retain their existing language semantics. */
export function workflowLayout(root: IrNode): WorkflowLayoutStep[] {
  const fail = () => {
    throw Error("BLK-WORKFLOW-SCOPE");
  };
  if (root.blockType !== "runtime.task.durable" || root.next) fail();
  const single = (value: IrNode | IrNode[] | null | undefined) => {
    if (Array.isArray(value)) fail();
    return value as IrNode | undefined;
  };
  const seen = new Set<IrNode>();
  const body = (node: IrNode): void => {
    if (
      seen.has(node) ||
      seen.size >= 2000 ||
      isWorkflowMarker(node.blockType) ||
      node.blockType === "runtime.task.durable"
    )
      fail();
    seen.add(node);
    for (const value of Object.values(node.inputs))
      for (const child of value ? (Array.isArray(value) ? value : [value]) : [])
        body(child);
    if (node.next) body(node.next);
  };
  const steps: WorkflowLayoutStep[] = [];
  for (let node = single(root.inputs.STEPS); node; node = node.next) {
    if (steps.length >= 64 || seen.has(node)) fail();
    seen.add(node);
    if (node.blockType === "runtime.compensate") {
      const run = single(node.inputs.DO),
        undo = single(node.inputs.UNDO);
      if (!run) fail();
      body(run!);
      if (undo) body(undo);
      steps.push({
        stepId: node.nodeId,
        kind: "action",
        compensate: !!undo,
        body: run!,
        ...(undo ? { undo } : {}),
      });
    } else if (node.blockType === "core.human.approve") {
      const label = node.fields.LABEL;
      if (
        typeof label !== "string" ||
        !label.length ||
        new TextEncoder().encode(label).length > 1000 ||
        label.includes("\0")
      )
        fail();
      steps.push({
        stepId: node.nodeId,
        kind: "approval",
        label: label as string,
      });
    } else if (node.blockType === "runtime.checkpoint.save")
      steps.push({ stepId: node.nodeId, kind: "checkpoint" });
    else fail();
  }
  if (!steps.length) fail();
  return steps;
}
