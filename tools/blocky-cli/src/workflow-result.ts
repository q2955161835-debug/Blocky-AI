import { workflowDecisionResultSchema } from "./workflow-schema";
import { CliError } from "./protocol";
export function workflowDecisionResult(
  value: unknown,
  request: {
    projectId: string;
    taskId: string;
    revision: number;
    approval?: string;
  },
) {
  const parsed = workflowDecisionResultSchema.safeParse(value);
  if (!parsed.success)
    throw new CliError(6, "BLK-WORKFLOW-INVALID", "工作流响应未通过校验。");
  const result = parsed.data,
    { projectId, taskId, revision, approval } = request;
  if (
    result.task.projectId !== projectId ||
    result.task.taskId !== taskId ||
    result.applied !== !!approval ||
    result.task.revision !== revision + (approval ? 1 : 0) ||
    (approval && result.requestDigest !== approval) ||
    (!result.applied &&
      (result.after.projectId !== projectId ||
        result.after.taskId !== taskId ||
        result.after.revision !== revision + 1))
  )
    throw new CliError(6, "BLK-WORKFLOW-BINDING", "工作流响应与请求不一致。");
  return result;
}
