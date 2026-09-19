import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { atomicOutput } from "./atomic-output";
import {
  Runtime,
  hostAdapters,
  nativeAgentServices,
  type PendingApproval,
} from "@blocky/runtime-core";
import {
  stableId,
  type Project,
  type Resource,
  type InteractionManifest,
} from "@blocky/language-schema";
import { type Args, required, integer } from "./arguments";
import { nativeUserOperation } from "./native-store";
import { envelope, CliError } from "./protocol";
export async function runAgent(
  args: Args,
  project: Project,
  entries: InteractionManifest["entries"],
  userRegistry: Map<string, Resource> | undefined,
  write: (value: unknown) => void,
  signal: AbortSignal,
) {
  const question = required(args, "input");
  if (Buffer.byteLength(question) > 16000)
    throw new CliError(2, "BLK-CLI-002", "问题输入超过 16000 字节。");
  const candidates = entries.filter(
    (e) =>
      !args.options.has("module") || e.moduleId === args.options.get("module"),
  );
  const matches = args.options.has("entry")
    ? candidates.filter((e) => e.interactionId === args.options.get("entry"))
    : candidates.slice(0, 1);
  if (matches.length !== 1)
    throw new CliError(3, "BLK-RUN-001", "交互入口不存在或不唯一。");
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
  const timer = setTimeout(cancel, integer(args, "timeout", 120000, 300000));
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
    const services = nativeAgentServices(call, {
      mode: "cli",
      live: args.options.has("live"),
      approved,
      pending: (p) => pending.push(p),
      ...(args.options.has("interactive")
        ? {
            approve: async (value: PendingApproval, s: AbortSignal) => {
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
    const runtime = new Runtime({
      newId: () => runId,
      sessionId: `session-${runId}`,
      adapters: hostAdapters(call, services),
    });
    const result = await runtime.run(
      project,
      matches[0].interactionId,
      question,
      {
        moduleId: matches[0].moduleId,
        userRegistry,
        signal: abort.signal,
        onEvent: write,
      },
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
      eventCount: result.events.length,
      runId,
      pendingApprovals: pending,
    });
    response.ok = result.status === "completed";
    return {
      code: pending.length
        ? 4
        : result.status === "completed"
          ? 0
          : result.status === "cancelled"
            ? 7
            : 3,
      result: response,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
