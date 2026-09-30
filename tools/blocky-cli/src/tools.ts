import { allow, required, type Args } from "./arguments";
import { nativeUserOperation } from "./native-store";
import { readJsonArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";
import {
  toolRequestSchema,
  toolIdSchema,
  toolOutcomeSchema,
} from "./tool-schema";
export const toolHelp = [
  "tool preflight --request <request.json> --json",
  "tool call --request <request.json> --approve <sha256> --json",
  "tool status --project-id <id> --json",
  "tool reconcile-preflight --project-id <id> --request-id <id> --outcome <confirmed-completed|confirmed-not-applied> --json",
  "tool reconcile --project-id <id> --request-id <id> --outcome <confirmed-completed|confirmed-not-applied> --approve <sha256> --json",
  "tool cleanup|cleanup-status --json",
];
const invalid = (message: string) =>
  new CliError(
    2,
    "BLK-CLI-002",
    message,
    "运行 command list --query tool 或 schema show blocky.tool-request/v2 查看格式。",
  );
function id(args: Args, key: string) {
  const value = required(args, key);
  if (!toolIdSchema.safeParse(value).success)
    throw invalid(`--${key} 必须是稳定标识。`);
  return value;
}
function approval(args: Args) {
  const requestDigest = required(args, "approve");
  if (!/^[a-f0-9]{64}$/.test(requestDigest))
    throw invalid("--approve 必须是本次预检返回的 SHA256 摘要。");
  return { approved: true, requestDigest };
}
export async function toolCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "tool") return;
  signal.throwIfAborted();
  const action = args.words[1],
    command = `tool.${action}`;
  const fields: Record<string, unknown> = {};
  if (action === "preflight" || action === "call") {
    allow(
      args,
      action === "call" ? ["request", "approve", "json"] : ["request", "json"],
      2,
    );
    const parsed = toolRequestSchema.safeParse(
      await readJsonArtifact(required(args, "request"), 65536),
    );
    if (!parsed.success)
      throw new CliError(
        3,
        "BLK-TOOL-INVALID",
        "工具请求不符合 v2 契约。",
        "运行 schema show blocky.tool-request/v2；仅填写资源引用。检查 input、action 和 1–120000ms 超时，端点、请求头及进程启动配置通过 secret-env 导入。",
      );
    fields.request = parsed.data;
    if (action === "call") fields.approval = approval(args);
  } else if (action === "status") {
    allow(args, ["project-id", "json"], 2);
    fields.projectId = id(args, "project-id");
  } else if (action === "reconcile-preflight" || action === "reconcile") {
    allow(
      args,
      [
        "project-id",
        "request-id",
        "outcome",
        "json",
        ...(action === "reconcile" ? ["approve"] : []),
      ],
      2,
    );
    fields.projectId = id(args, "project-id");
    fields.requestId = id(args, "request-id");
    const parsed = toolOutcomeSchema.safeParse(required(args, "outcome"));
    if (!parsed.success)
      throw invalid(
        "--outcome 仅支持 confirmed-completed 或 confirmed-not-applied；先核实实际副作用。",
      );
    fields.outcome = parsed.data;
    if (action === "reconcile") fields.approval = approval(args);
  } else if (action === "cleanup" || action === "cleanup-status") {
    allow(args, ["json"], 2);
  } else throw invalid("工具命令不存在。");
  signal.throwIfAborted();
  const value = await nativeUserOperation(`tool-${action}`, fields, signal);
  const result = envelope(command, value);
  if (
    action === "status" &&
    typeof value === "object" &&
    value !== null &&
    "receipts" in value &&
    Array.isArray(value.receipts) &&
    value.receipts.some(
      (receipt: unknown) =>
        typeof receipt === "object" &&
        receipt !== null &&
        "status" in receipt &&
        receipt.status === "unknown",
    )
  )
    result.warnings.push(
      "有工具调用结果未知。先核实目标服务的实际副作用，再用 tool reconcile-preflight 和 tool reconcile 确认结果；不要自动重发。",
    );
  return { code: 0, result };
}
