import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { atomicOutput } from "./atomic-output";
import {
  Runtime,
  hostAdapters,
  nativeAgentServices,
  type PendingApproval,
  type RunResult,
  type WorkflowPorts,
} from "@blocky/runtime-core";
import {
  stableId,
  agentBudgetDefaults,
  agentBudgetLimits,
  type Project,
  type Resource,
  type InteractionManifest,
} from "@blocky/language-schema";
import { type Args, required, integer } from "./arguments";
import { nativeUserOperation, workspaceTransport } from "./native-store";
import { envelope, CliError } from "./protocol";
import { TraceSession } from "@blocky/observability";
import { readJsonArtifact } from "./artifacts";
import { runInputsSchema } from "./run-inputs";
import { cliRpaModules } from "./rpa-module";
import { rpaModuleInputsSchema } from "@blocky/rpa-core";
import { cliWorkflowPorts } from "./workflow-session";
import { workflowIdSchema } from "./workflow-schema";
export type RunAgentContext = { workflow: WorkflowPorts; approve(value: PendingApproval, signal: AbortSignal): Promise<boolean> };
export async function runAgent(
  args: Args,
  project: Project,
  entries: InteractionManifest["entries"],
  userRegistry: Map<string, Resource> | undefined,
  write: (value: unknown) => void,
  signal: AbortSignal,
  context?: RunAgentContext,
) {
  const workflowTaskId = args.options.has("workflow-task") ? required(args, "workflow-task") : undefined;
  if (workflowTaskId !== undefined && (!workflowIdSchema.safeParse(workflowTaskId).success || args.options.has("inputs-file") || args.options.has("from-block")))
    throw new CliError(2, "BLK-CLI-002", "工作流恢复需要一个有效任务标识和单次输入，不能从中间积木启动。");
  const rpaInputs=args.options.has("rpa-inputs") ? rpaModuleInputsSchema.parse(await readJsonArtifact(required(args,"rpa-inputs"),65536)) : {};
  if (args.options.has("input") === args.options.has("inputs-file"))
    throw new CliError(
      2,
      "BLK-CLI-002",
      "请选择 --input 或 --inputs-file 之一。",
    );
  let questions: string[];
  if (args.options.has("inputs-file")) {
    let input: unknown;
    try {
      input = await readJsonArtifact(required(args, "inputs-file"), 128 * 1024);
    } catch {
      throw new CliError(
        2,
        "BLK-CLI-002",
        "连续输入须为不超过 128 KiB 的 JSON 文件。",
      );
    }
    const parsed = runInputsSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.some((q) => Buffer.byteLength(q) > 16000)
    )
      throw new CliError(
        2,
        "BLK-CLI-002",
        "连续输入须含 1–32 个字符串，每项最多 16000 字节。",
      );
    questions = parsed.data;
  } else questions = [required(args, "input")];
  if (questions.some((q) => Buffer.byteLength(q) > 16000))
    throw new CliError(2, "BLK-CLI-002", "问题输入超过 16000 字节。");
  if (questions.length > 1 && args.options.has("output"))
    throw new CliError(
      2,
      "BLK-CLI-002",
      "连续输入的文件结果在 runs 中返回；单个 --output 仅用于一次输入。",
    );
  const candidates = entries.filter(
    (e) =>
      !args.options.has("module") || e.moduleId === args.options.get("module"),
  );
  const matches = args.options.has("entry")
    ? candidates.filter((e) => e.interactionId === args.options.get("entry"))
    : candidates.slice(0, 1);
  if (matches.length !== 1)
    throw new CliError(3, "BLK-RUN-001", "交互入口不存在或不唯一。");
  const fromBlock = args.options.get("from-block");
  if (
    fromBlock !== undefined &&
    (typeof fromBlock !== "string" || !stableId.test(fromBlock))
  )
    throw new CliError(2, "BLK-CLI-002", "所选积木 ID 无效。");
  const breakpoint = args.options.get("breakpoint");
  let breakpoints: { moduleId: string; blockId: string }[] = [];
  if (breakpoint !== undefined) {
    if (typeof breakpoint !== "string" || !args.options.has("debug-actions"))
      throw new CliError(
        2,
        "BLK-CLI-002",
        "断点需要 --debug-actions 文件指定每次暂停后的动作。",
      );
    const pairs = breakpoint.split(",");
    if (
      pairs.length > 64 ||
      pairs.some((pair) => !/^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/.test(pair))
    )
      throw new CliError(2, "BLK-CLI-002", "断点应为 module-id:block-id。");
    breakpoints = pairs.map((pair) => {
      const [moduleId, blockId] = pair.split(":");
      return { moduleId, blockId };
    });
    if (
      breakpoints.some(
        ({ moduleId, blockId }) =>
          !stableId.test(moduleId) || !stableId.test(blockId),
      )
    )
      throw new CliError(2, "BLK-CLI-002", "断点应为 module-id:block-id。");
  }
  if (args.options.has("debug-actions") && !breakpoints.length)
    throw new CliError(2, "BLK-CLI-002", "调试动作需要 --breakpoint。");
  let debugActions: ("step" | "continue" | "stop")[] = [];
  if (breakpoints.length) {
    const bytes = await readFile(required(args, "debug-actions"));
    if (bytes.length > 4096)
      throw new CliError(2, "BLK-CLI-002", "调试动作文件过大。");
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new CliError(2, "BLK-CLI-002", "调试动作须为 JSON 数组。");
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length > 100 ||
      parsed.some((item) => !["step", "continue", "stop"].includes(item))
    )
      throw new CliError(
        2,
        "BLK-CLI-002",
        "调试动作只能是 step、continue 或 stop。",
      );
    debugActions = parsed;
  }
  const runId = String(
    args.options.get("run-id") ?? `run-${crypto.randomUUID()}`,
  );
  if (!stableId.test(runId) || runId.length > 64)
    throw new CliError(2, "BLK-CLI-002", "运行标识无效。");
  const approved = new Set<string>();
  if (args.options.has("approval-file")) {
    const bytes = await readFile(required(args, "approval-file"));
    if (bytes.length > 16384)
      throw new CliError(2, "BLK-CLI-002", "批准清单过大。");
    let list: unknown;
    try {
      list = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new CliError(2, "BLK-CLI-002", "批准清单必须是请求摘要数组。");
    }
    if (
      !Array.isArray(list) ||
      list.length > 64 ||
      list.some((v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
    )
      throw new CliError(2, "BLK-CLI-002", "批准清单必须是请求摘要数组。");
    for (const item of list) approved.add(item as string);
  }
  const pending: PendingApproval[] = [];
  const abort = new AbortController(),
    cancel = () => abort.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(cancel, integer(args, "timeout", agentBudgetDefaults.durationMs, agentBudgetLimits.durationMs));
  const call = async (
    operation: string,
    fields: Record<string, unknown>,
    s?: AbortSignal,
  ) => {
    try {
      return await nativeUserOperation(operation, fields, s);
    } catch (error) {
      if (error instanceof CliError) throw Error(error.code);
      throw error;
    }
  };
  try {
    if (args.options.has("workspace-dir")) await workspaceTransport.bind(project.manifest.projectId, required(args, "workspace-dir"), abort.signal);
    const services = nativeAgentServices(call, {
      mode: "cli",
      live: args.options.has("live"),
      approved,
      pending: (p) => pending.push(p),
      ...(args.options.has("interactive")
        ? {
            approve: async (value: PendingApproval, s: AbortSignal) => {
              if (context) return context.approve(value, s);
              write(envelope("run.approval-required", value));
              const lines = createInterface({
                input: process.stdin,
                output: process.stderr,
                terminal: false,
              });
              try {
                const answer = await lines.question(
                  "输入该请求的完整摘要以批准，其他输入拒绝：\n",
                  { signal: s },
                );
                return answer.trim() === value.requestDigest;
              } finally {
                lines.close();
              }
            },
          }
        : {}),
    });
    let ordinal = 0;
    const runtime = new Runtime({
      newId: () => (questions.length === 1 ? runId : `${runId}-r${++ordinal}`),
      sessionId: `session-${runId}`,
      adapters: { ...hostAdapters(call, services, args.options.has("live") ? cliRpaModules(rpaInputs) : undefined), workflow: context?.workflow ?? cliWorkflowPorts() },
    });
    let trace = new TraceSession();
    const results: RunResult[] = [];
    for (const question of questions) {
      trace = new TraceSession();
      const result = await runtime.run(
        project,
        matches[0].interactionId,
        question,
        {
          moduleId: matches[0].moduleId,
          userRegistry,
          signal: abort.signal,
          ...(workflowTaskId ? { workflowTaskId } : {}),
          debug: {
            breakpoints,
            ...(fromBlock ? { startBlockId: fromBlock } : {}),
          },
          onEvent(event) {
            trace.add(event);
            write(event);
            if (event.type === "run.paused" && event.data.reason !== "workflow-waiting") {
              const action = debugActions.shift() ?? "stop";
              if (action === "step") runtime.step();
              else if (action === "continue") runtime.resume();
              else abort.abort();
            }
          },
        },
      );
      results.push(result);
      if (result.status !== "completed") break;
    }
    const result = results[results.length - 1];
    if (args.options.has("trace-output"))
      await atomicOutput(
        required(args, "trace-output"),
        JSON.stringify(trace.export(), null, 2),
        signal,
      );
    if (args.options.has("output") && result.status === "completed") {
      if (result.files?.length !== 1)
        throw new CliError(
          2,
          "BLK-OUTPUT-002",
          "指定 --output 需要且只允许一个文件输出。",
        );
      signal.throwIfAborted();
      await atomicOutput(
        required(args, "output"),
        result.files[0].content,
        signal,
      );
    }
    const response = envelope("run.start", {
      ...result,
      events: undefined,
      modelApiCalled: results.some((r) => r.modelApiCalled),
      eventCount: results.reduce((sum, r) => sum + r.events.length, 0),
      runId: result.events[0]?.runId ?? runId,
      ...(questions.length > 1
        ? {
            sessionId: `session-${runId}`,
            requestedInputs: questions.length,
            completedInputs: results.filter((r) => r.status === "completed")
              .length,
            runs: results.map((r) => ({
              ...r,
              events: undefined,
              eventCount: r.events.length,
              runId: r.events[0]?.runId,
            })),
            traceScope: "last-run",
          }
        : {}),
      pendingApprovals: pending,
      ...(args.options.has("workspace-dir") ? { workspace: await workspaceTransport.status(project.manifest.projectId) } : {}),
    });
    response.ok = result.status === "completed";
    return {
      code: pending.length || result.status === "waiting"
        ? 4
        : result.status === "completed"
          ? 0
          : result.status === "cancelled"
            ? 7
            : 3,
      result: response,
    };
  } finally {
    for(const key of Object.keys(rpaInputs)) delete rpaInputs[key];
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
