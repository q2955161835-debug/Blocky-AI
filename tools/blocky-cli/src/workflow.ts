import { allow, required, type Args } from "./arguments";
import { CliError, envelope } from "./protocol";
import { nativeUserOperation } from "./native-store";
import { workflowIdSchema, workflowSummarySchema } from "./workflow-schema";

export const workflowHelp = [
  "workflow list --project-id <id> --json",
  "workflow show <task-id> --project-id <id> --json",
];
export async function workflowCommand(args: Args, signal: AbortSignal) {
  const command = args.words.slice(0, 2).join(".");
  if (!["workflow.list", "workflow.show"].includes(command)) return;
  allow(args, ["project-id", "json"], command === "workflow.list" ? 2 : 3);
  const project = workflowIdSchema.safeParse(required(args, "project-id"));
  const task =
    command === "workflow.show"
      ? workflowIdSchema.safeParse(args.words[2])
      : undefined;
  if (!project.success || (task && !task.success))
    throw new CliError(
      3,
      "BLK-WORKFLOW-INVALID",
      "项目或工作流任务标识无效。",
      "使用 project inspect 获取项目标识，再运行 workflow list。",
    );
  const value = await nativeUserOperation(
    command.replace(".", "-"),
    {
      projectId: project.data,
      ...(task?.success ? { taskId: task.data } : {}),
    },
    signal,
  );
  const parsed =
    command === "workflow.list"
      ? workflowSummarySchema.array().max(128).safeParse(value)
      : workflowSummarySchema.safeParse(value);
  if (!parsed.success)
    throw new CliError(
      6,
      "BLK-WORKFLOW-INVALID",
      "工作流摘要未通过校验。",
      "保留任务记录，核对本机组件版本。",
    );
  const tasks = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (
    tasks.some(
      (item) =>
        item.projectId !== project.data ||
        (task?.success && item.taskId !== task.data),
    ) ||
    new Set(tasks.map((item) => item.taskId)).size !== tasks.length
  )
    throw new CliError(
      6,
      "BLK-WORKFLOW-BINDING",
      "工作流摘要与本次查询不一致。",
    );
  return {
    code: 0,
    result: envelope(command, {
      ...(command === "workflow.list" ? { tasks } : { task: tasks[0] }),
      modelApiCalled: false,
    }),
  };
}
