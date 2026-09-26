import {
  parseWorkflowDecisionResult,
  parseWorkflowReconciliationResult,
} from "@blocky/runtime-core";
import { CliError } from "./protocol";
function checked<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    const code =
      error instanceof Error && error.message === "BLK-WORKFLOW-BINDING"
        ? error.message
        : "BLK-WORKFLOW-INVALID";
    throw new CliError(6, code, "工作流响应未通过绑定校验。");
  }
}
export const workflowDecisionResult = (
  ...args: Parameters<typeof parseWorkflowDecisionResult>
) => checked(() => parseWorkflowDecisionResult(...args));
export const workflowReconciliationResult = (
  ...args: Parameters<typeof parseWorkflowReconciliationResult>
) => checked(() => parseWorkflowReconciliationResult(...args));
