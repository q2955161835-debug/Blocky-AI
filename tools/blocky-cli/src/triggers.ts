import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  Runtime,
  TriggerScheduler,
  createTriggerClient,
  createTriggerReceiverClient,
  hostAdapters,
  nativeAgentServices,
  triggerConfigSchema,
  triggerRequestSchema,
  type PendingApproval,
  type TriggerOutcome,
  type TriggerRequest,
} from "@blocky/runtime-core";
import { stableId } from "@blocky/language-schema";
import { compileProject } from "@blocky/compiler";
import { cliRpaModules } from "./rpa-module";
import { cliWorkflowPorts } from "./workflow-session";
import { readJsonArtifact } from "./artifacts";
import { allow, integer, required, type Args } from "./arguments";
import { nativeUserOperation, readProject } from "./native-store";
import { userRegistryMap } from "./user-config";
import { CliError, envelope } from "./protocol";
import { TriggerTransport } from "./trigger-transport";
import { setTimeout as delay } from "node:timers/promises";

const idSchema = (value: string) => value.length <= 128 && stableId.test(value);
const hashSchema = /^[a-f0-9]{64}$/u;
const idError = () => new CliError(2, "BLK-CLI-002", "触发器参数必须使用稳定 ID 和有效修订。", "运行 blocky --help 查看 trigger 命令格式。");

export const triggerHelp = [
  "trigger create <project.blocky> --id <id> --module <id> --entry <id> --enabled true [--type timer --at <epoch-ms> [--interval-ms <ms>] [--time-zone UTC|+08:00] [--misfire skip|latest] | --type external --source <id>] [--approve <sha256>] [--interactive] --json",
  "trigger list <project.blocky> [--approve <sha256>] [--interactive] --json",
  "trigger pause <project.blocky> --id <id> --revision <n> --paused true|false [--approve <sha256>] [--interactive] --json",
  "trigger run|watch <project.blocky> --id <id> --enabled true --simulate|--live [--session-id <id> --request-id <id>] [--approve <sha256>] [--approval-file <sha256-array.json>] [--interactive] [--interval-ms <ms>] --jsonl",
  "trigger listen <project.blocky> --id <id> --secret-ref <stable-ref> --enabled true --simulate|--live [--session-id <id> --request-id <id>] [--approve <sha256>] [--approval-file <sha256-array.json>] [--interactive] --jsonl",
];

function requestId(projectId: string, action: string, fields: Record<string, unknown>) {
  const hash = createHash("sha256").update(JSON.stringify({ projectId, action, fields })).digest("hex").slice(0, 32);
  return `trigger-${hash}`;
}
function requestFor(projectId: string, sessionId: string, action: TriggerRequest["action"], fields: Record<string, unknown>) {
  const request = triggerRequestSchema.safeParse({
    schemaVersion: "blocky.trigger-request/v1",
    requestId: requestId(projectId, action, fields),
    projectId,
    sessionId,
    action,
    ...fields,
  });
  if (!request.success) throw new CliError(3, "BLK-TRIGGER-REQUEST", "触发器请求无效。", "检查项目、ID、修订和时间字段，再运行 trigger preflight 或交互审批。");
  return request.data;
}

function summarizeOutcome(outcome: TriggerOutcome) {
  if (outcome.kind === "completed") return {
    kind: outcome.kind,
    occurrence: outcome.occurrence,
    record: outcome.record,
    result: { status: outcome.result.status, workflowTaskId: outcome.result.workflow?.taskId, modelApiCalled: outcome.result.modelApiCalled, eventCount: outcome.result.events.length },
  };
  if ("result" in outcome && outcome.result) return {
    ...outcome,
    result: { status: outcome.result.status, workflowTaskId: outcome.result.workflow?.taskId, modelApiCalled: outcome.result.modelApiCalled, eventCount: outcome.result.events.length },
  };
  return outcome;
}

async function promptApproval(
  args: Args,
  write: (value: unknown) => void,
  approval: { kind: string; requestDigest: string; preview: unknown },
  signal: AbortSignal,
): Promise<boolean> {
  write(envelope("trigger.approval-required", approval));
  if (!args.options.has("interactive")) return false;
  signal.throwIfAborted();
  const lines = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  try {
    const answer = await lines.question("输入该请求的完整摘要以批准，其他输入拒绝：\n", { signal });
    return answer.trim() === approval.requestDigest;
  } finally {
    lines.close();
  }
}

async function oneShot(
  args: Args,
  request: TriggerRequest,
  write: (value: unknown) => void,
  signal: AbortSignal,
) {
  let requestDigest: string | undefined;
  let preview: unknown;
  if (args.options.has("approve")) {
    requestDigest = required(args, "approve");
    if (!hashSchema.test(requestDigest)) throw idError();
  } else {
    preview = await nativeUserOperation("agent-trigger-preflight", { request }, signal);
    if (!preview || typeof preview !== "object" || !hashSchema.test(String((preview as { requestDigest?: unknown }).requestDigest ?? "")))
      throw new CliError(6, "BLK-TRIGGER-RESPONSE", "触发器预检响应无效。", "保留触发器记录并核对本机组件版本。");
    requestDigest = String((preview as { requestDigest: string }).requestDigest);
    const approved = await promptApproval(args, write, { kind: "trigger", requestDigest, preview }, signal);
    if (!approved) {
      const result = envelope("trigger.preflight", { request, preview, requiresApproval: true, next: "repeat this command with --approve and the returned requestDigest" });
      result.ok = false;
      return { code: 4, result };
    }
  }
  const value = await nativeUserOperation("agent-trigger", {
    request,
    approval: { approved: true, requestDigest },
  }, signal);
  return { code: 0, result: envelope(`trigger.${request.action}`, value) };
}

function validateInput(args: Args, keys: string[], words: number) {
  allow(args, keys, words);
  if (args.options.has("approve") && (typeof args.options.get("approve") !== "string" || !hashSchema.test(String(args.options.get("approve"))))) throw idError();
}

async function sessionApproval(
  args: Args,
  projectId: string,
  write: (value: unknown) => void,
  signal: AbortSignal,
) {
  const requestIdValue = args.options.has("request-id") ? required(args, "request-id") : `trigger-${crypto.randomUUID()}`;
  const sessionId = args.options.has("session-id") ? required(args, "session-id") : `trigger-session-${crypto.randomUUID()}`;
  if (!idSchema(requestIdValue) || !idSchema(sessionId)) throw idError();
  const context = { schemaVersion: "blocky.trigger-session/v1", requestId: requestIdValue, projectId, sessionId } as const;
  const preview = await nativeUserOperation("agent-trigger-session-preflight", { request: context }, signal) as { requestDigest?: unknown };
  if (!preview || typeof preview.requestDigest !== "string" || !hashSchema.test(preview.requestDigest))
    throw new CliError(6, "BLK-TRIGGER-RESPONSE", "触发器会话预检响应无效。");
  let approved = typeof args.options.get("approve") === "string" && args.options.get("approve") === preview.requestDigest;
  if (!approved && args.options.has("interactive")) {
    approved = await promptApproval(args, write, { kind: "trigger", requestDigest: preview.requestDigest, preview }, signal);
  }
  if (!approved) {
    const result = envelope("trigger.session-preflight", {
      projectId,
      sessionId,
      requestId: requestIdValue,
      requestDigest: preview.requestDigest,
      requiresApproval: true,
      next: "repeat this command with the same --session-id and --request-id plus --approve <requestDigest>",
    });
    result.ok = false;
    return { result: { context, digest: preview.requestDigest }, response: { code: 4, result } };
  }
  return { result: { context, digest: preview.requestDigest } };
}

export async function triggerCommand(
  args: Args,
  write: (value: unknown) => void,
  signal: AbortSignal,
) {
  if (args.words[0] !== "trigger") return;
  signal.throwIfAborted();
  const action = args.words[1];
  if (action === "create") {
    validateInput(args, ["id", "module", "entry", "type", "source", "at", "interval-ms", "time-zone", "misfire", "enabled", "approve", "interactive", "json"], 3);
    if (required(args, "enabled") !== "true") throw new CliError(2, "BLK-TRIGGER-OPT-IN", "创建触发器必须显式指定 --enabled true。");
    const project = await readProject(args.words[2]);
    const registry = await userRegistryMap();
    const compiled = await compileProject(project, registry);
    const triggerId = required(args, "id"), moduleId = required(args, "module"), exportId = required(args, "entry");
    if (![triggerId, moduleId, exportId].every(idSchema) || !compiled.interaction.entries.some((entry) => entry.moduleId === moduleId && entry.interactionId === exportId)) throw idError();
    const type = args.options.has("type") ? required(args, "type") : "timer";
    let triggerBody: Record<string, unknown>;
    if (type === "external") {
      const sourceId = required(args, "source");
      if (!idSchema(sourceId) || ["at", "interval-ms", "time-zone", "misfire"].some((key) => args.options.has(key))) throw idError();
      triggerBody = { type, sourceId };
    } else if (type === "timer") {
      if (!args.options.has("at") || args.options.has("source")) throw idError();
      const startsAt = Number(required(args, "at"));
      const intervalMs = args.options.has("interval-ms") ? integer(args, "interval-ms", 1000, 31_536_000_000) : undefined;
      const timeZone = args.options.has("time-zone") ? required(args, "time-zone") : "UTC";
      const misfire = args.options.has("misfire") ? required(args, "misfire") : "skip";
      triggerBody = {
        type,
        schedule: { kind: intervalMs === undefined ? "once" : "interval", startsAt, timeZone, misfire, ...(intervalMs === undefined ? {} : { intervalMs }) },
      };
    } else throw idError();
    const config = triggerConfigSchema.safeParse({
      schemaVersion: "blocky.trigger/v1", triggerId, projectId: project.manifest.projectId,
      moduleId, exportId, revision: 1, enabled: true, ...triggerBody,
    });
    if (!config.success) throw idError();
    const session = `session-${requestId(project.manifest.projectId, "upsert", { config: config.data, expectedRevision: null }).slice("trigger-".length)}`;
    const request = requestFor(project.manifest.projectId, session, "upsert", { config: config.data, expectedRevision: null });
    return oneShot(args, request, write, signal);
  }

  if (action === "list") {
    validateInput(args, ["approve", "interactive", "json"], 3);
    const project = await readProject(args.words[2]);
    const request = requestFor(project.manifest.projectId, `session-${requestId(project.manifest.projectId, "list", {})}`, "list", {});
    return oneShot(args, request, write, signal);
  }

  if (action === "pause") {
    validateInput(args, ["id", "revision", "paused", "approve", "interactive", "json"], 3);
    const project = await readProject(args.words[2]);
    const triggerId = required(args, "id"), revision = integer(args, "revision", 1, Number.MAX_SAFE_INTEGER);
    const pausedValue = required(args, "paused");
    if (!idSchema(triggerId) || !["true", "false"].includes(pausedValue)) throw idError();
    const fields = { triggerId, expectedRevision: revision, paused: pausedValue === "true" };
    const request = requestFor(project.manifest.projectId, `session-${requestId(project.manifest.projectId, "pause", fields)}`, "pause", fields);
    return oneShot(args, request, write, signal);
  }

  if (action !== "run" && action !== "watch" && action !== "listen") return;
  validateInput(args, ["id", "secret-ref", "enabled", "simulate", "live", "session-id", "request-id", "approve", "interactive", "approval-file", "interval-ms", "jsonl"], 3);
  if (!args.options.has("jsonl") || args.options.has("simulate") === args.options.has("live")) throw idError();
  if (required(args, "enabled") !== "true") throw new CliError(2, "BLK-TRIGGER-OPT-IN", "定时执行必须显式指定 --enabled true。");
  if (args.options.has("live") && !args.options.has("interactive") && !args.options.has("approval-file"))
    throw new CliError(2, "BLK-TRIGGER-LIVE-APPROVAL", "实时触发执行需要 --interactive 或 --approval-file。");
  const project = await readProject(args.words[2]);
  const registry = await userRegistryMap();
  const compiled = await compileProject(project, registry);
  const triggerId = required(args, "id");
  if (!idSchema(triggerId)) throw idError();
  const approval = await sessionApproval(args, project.manifest.projectId, write, signal);
  if (approval.response) return approval.response;
  const transport = new TriggerTransport();
  const { context, digest } = approval.result;
  let modelApiCalled = false;
  try {
    await transport.open(context, digest);
    const client = createTriggerClient({
      projectId: project.manifest.projectId,
      sessionId: context.sessionId,
      send: (request, requestSignal) => transport.request("manage", request as unknown as Record<string, unknown>, requestSignal),
    });
    const config = await client.read(triggerId, signal);
    const expectedType = action === "listen" ? "external" : "timer";
    if (!config || config.projectId !== project.manifest.projectId || config.type !== expectedType || !config.enabled ||
      !compiled.interaction.entries.some((entry) => entry.moduleId === config.moduleId && entry.interactionId === config.exportId))
      throw new CliError(3, "BLK-TRIGGER-BINDING", "触发器当前类型、启用状态或项目绑定不匹配。");

    const approved = new Set<string>();
    if (args.options.has("approval-file")) {
      const hashes = await readJsonArtifact(required(args, "approval-file"), 65536);
      if (!Array.isArray(hashes) || hashes.some((hash) => typeof hash !== "string" || !hashSchema.test(hash))) throw idError();
      hashes.forEach((hash) => approved.add(hash));
    }
    const call = async (operation: string, fields: Record<string, unknown>, requestSignal?: AbortSignal) => {
      try { return await nativeUserOperation(operation, fields, requestSignal); }
      catch (error) { if (error instanceof CliError) throw Error(error.code); throw error; }
    };
    const scheduler = new TriggerScheduler({
      client,
      now: Date.now,
      pollIntervalMs: args.options.has("interval-ms") ? integer(args, "interval-ms", 1000, 60_000) : 1_000,
      ...(action === "listen" ? {} : { onEvent: write }),
      createRuntime: (runSignal) => {
        const services = args.options.has("live") ? nativeAgentServices(call, {
          mode: "cli", live: true, approved,
          ...(args.options.has("interactive") ? { approve: async (value: PendingApproval, approvalSignal: AbortSignal) => {
            write(envelope("trigger.approval-required", value));
            const lines = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
            try { return (await lines.question("输入该请求的完整摘要以批准，其他输入拒绝：\n", { signal: approvalSignal })).trim() === value.requestDigest; }
            finally { lines.close(); }
          } } : {}),
          pending: (value) => write(envelope("trigger.approval-required", value)),
        }) : undefined;
        return {
          project,
          userRegistry: registry,
          runtime: new Runtime({ adapters: {
            ...hostAdapters(call, services, cliRpaModules({})),
            workflow: cliWorkflowPorts(),
          } }),
          dispose: async () => { await services?.close?.(runSignal); },
        };
      },
    });

    if (action === "listen") {
      const secretRef = required(args, "secret-ref");
      if (!idSchema(secretRef)) throw idError();
      const receiver = createTriggerReceiverClient({
        projectId: project.manifest.projectId,
        sessionId: context.sessionId,
        send: (request, requestSignal) => transport.request("receiver", request as unknown as Record<string, unknown>, requestSignal),
      });
      let receiverId: string | undefined;
      let blocked = false;
      try {
        const started = await receiver.start(triggerId, config.revision, secretRef, signal);
        receiverId = started.receiverId;
        write(envelope("trigger.listen.started", { triggerId, receiverId, endpoint: started.endpoint, configRevision: started.configRevision }));
        while (!signal.aborted && !blocked) {
          const polled = await receiver.poll(receiverId, signal);
          if (!polled.active) {
            write(envelope("trigger.listen.revoked", { triggerId, receiverId }));
            break;
          }
          const remaining = polled.events.map(({ occurrence }) => occurrence.occurrenceId);
          for (const event of polled.events) {
            const outcome = await scheduler.runExternal(event.occurrence, event.payload, signal, remaining);
            if ("result" in outcome && outcome.result) modelApiCalled ||= Boolean(outcome.result.modelApiCalled);
            write(envelope("trigger.listen.outcome", { outcome: summarizeOutcome(outcome), modelApiCalled }));
            if (outcome.kind !== "completed") { blocked = true; break; }
            const index = remaining.indexOf(event.occurrence.occurrenceId);
            if (index >= 0) remaining.splice(index, 1);
          }
          if (!blocked && polled.events.length === 0) await delay(250, undefined, { signal }).catch(() => {});
        }
      } finally {
        if (receiverId) {
          try { await receiver.stop(receiverId, new AbortController().signal); } catch { /* revoked receivers are already stopped by Host */ }
        }
      }
      return { code: blocked ? 4 : signal.aborted ? 7 : 0, result: envelope("trigger.listen", { stopped: true, blocked, modelApiCalled }) };
    }

    if (action === "run") {
      const outcome = await scheduler.runDue(triggerId, signal);
      if ("result" in outcome && outcome.result) modelApiCalled ||= Boolean(outcome.result.modelApiCalled);
      return { code: outcome.kind === "completed" ? 0 : outcome.kind === "blocked" ? 4 : 0, result: envelope("trigger.run", { outcome: summarizeOutcome(outcome), modelApiCalled }) };
    }
    let blocked = false;
    await scheduler.watch(triggerId, signal, (outcome) => {
      if ("result" in outcome && outcome.result) modelApiCalled ||= Boolean(outcome.result.modelApiCalled);
      write(envelope("trigger.watch.outcome", { outcome: summarizeOutcome(outcome), modelApiCalled }));
      if (outcome.kind === "blocked") blocked = true;
    });
    return { code: blocked ? 4 : signal.aborted ? 7 : 0, result: envelope("trigger.watch", { stopped: true, blocked, modelApiCalled }) };
  } finally {
    await transport.close();
  }
}
