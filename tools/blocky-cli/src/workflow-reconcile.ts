import { allow, required, integer, type Args } from "./arguments";
import { readJsonArtifact } from "./artifacts";
import { nativeUserOperation } from "./native-store";
import { CliError, envelope } from "./protocol";
import { workflowReconciliationSchema } from "./workflow-schema";
import { workflowReconciliationResult } from "./workflow-result";

export async function workflowReconcile(args: Args, signal: AbortSignal) {
  allow(
    args,
    [
      "project-id",
      "revision",
      "step",
      "direction",
      "outcome",
      "state",
      "approve",
      "json",
    ],
    3,
  );
  required(args, "revision");
  const outcome = required(args, "outcome");
  if ((outcome === "completed") !== args.options.has("state"))
    throw new CliError(
      3,
      "BLK-WORKFLOW-INVALID",
      "确认已完成时必须提供核对后的 --state JSON 文件；确认未执行时不得提供状态。",
    );
  const parsed = workflowReconciliationSchema.safeParse({
    projectId: required(args, "project-id"),
    taskId: args.words[2],
    stepId: required(args, "step"),
    revision: integer(args, "revision", 1, 65535),
    direction: required(args, "direction"),
    outcome,
    ...(args.options.has("state")
      ? { state: await readJsonArtifact(required(args, "state"), 131072) }
      : {}),
    ...(args.options.has("approve")
      ? { approval: required(args, "approve") }
      : {}),
  });
  if (!parsed.success)
    throw new CliError(3, "BLK-WORKFLOW-INVALID", "工作流核对参数无效。");
  const request = parsed.data;
  try {
    const result = workflowReconciliationResult(
      await nativeUserOperation("workflow-reconcile", request, signal),
      request,
    );
    return {
      code: 0,
      result: envelope("workflow.reconcile", {
        ...result,
        modelApiCalled: false,
      }),
    };
  } catch (error) {
    if (!request.approval) throw error;
    throw new CliError(
      error instanceof CliError ? error.exitCode : 6,
      error instanceof CliError ? error.code : "BLK-WORKFLOW-CHANNEL",
      "核对结果未确认，请读取任务当前状态。",
      "使用 workflow show 核对修订号和核对记录；不要直接重复提交决定。",
    );
  }
}
