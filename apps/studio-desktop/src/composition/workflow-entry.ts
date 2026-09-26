import type { Compilation } from "@blocky/compiler";
import { resolveRunEntry, type WorkflowSummary } from "@blocky/runtime-core";
export function workflowEntry(
  compiled: Compilation,
  task: Pick<WorkflowSummary, "projectId" | "moduleId" | "blockId">,
) {
  if (compiled.interaction.projectId !== task.projectId) return undefined;
  const module = compiled.modules.find((m) => m.moduleId === task.moduleId);
  return compiled.interaction.entries.find((entry) => {
    if (entry.moduleId !== task.moduleId) return false;
    const root = module?.roots.find(
      (node) => node.nodeId === entry.ownerAgentId,
    );
    const flow =
      root && resolveRunEntry(root, entry.interactionId)?.workflowRoot;
    return (
      flow?.blockType === "runtime.task.durable" && flow.nodeId === task.blockId
    );
  });
}
