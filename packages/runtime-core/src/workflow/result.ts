import { workflowDecisionResultSchema } from "./schema";
import { requireWorkflow } from "./protocol";
export function parseWorkflowDecisionResult(
  value: unknown,
  request: {
    projectId: string;
    taskId: string;
    revision: number;
    approval?: string;
  },
) {
  const parsed = workflowDecisionResultSchema.safeParse(value);
  requireWorkflow(parsed.success);
  const result = parsed.data,
    { projectId, taskId, revision, approval } = request;
  requireWorkflow(
    result.task.projectId === projectId &&
      result.task.taskId === taskId &&
      result.applied === !!approval &&
      result.task.revision === revision + (approval ? 1 : 0) &&
      (!approval || result.requestDigest === approval) &&
      (result.applied ||
        (result.after.projectId === projectId &&
          result.after.taskId === taskId &&
          result.after.revision === revision + 1)),
    "BLK-WORKFLOW-BINDING",
  );
  return result;
}
export function parseWorkflowReconciliationResult(
  value: unknown,
  request: {
    projectId: string;
    taskId: string;
    revision: number;
    approval?: string;
    stepId: string;
    direction: "forward" | "rollback";
    outcome: "completed" | "not-executed";
  },
) {
  const result = parseWorkflowDecisionResult(value, request);
  const after = result.applied ? result.task : result.after,
    resolution = after.resolutions.at(-1);
  requireWorkflow(
    resolution?.revision === request.revision &&
      resolution.stepId === request.stepId &&
      resolution.direction === request.direction &&
      resolution.outcome === request.outcome &&
      !after.active &&
      (result.applied ||
        (result.task.active?.stepId === request.stepId &&
          result.task.active.direction === request.direction)),
    "BLK-WORKFLOW-BINDING",
  );
  return result;
}
