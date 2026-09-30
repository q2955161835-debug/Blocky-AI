import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { allow, required, type Args } from "./arguments";
import { nativeUserOperation } from "./native-store";
import { readJsonArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";
import {
  modelIdSchema,
  modelRequestSchema,
  modelResponseSchema,
} from "./model-schema";

export const modelHelp = [
  "model catalog --json",
  "model status|verify|remove|cleanup <model-id> --json",
  "model install <model-id> --backend <cpu|vulkan> (--download | --model-file <gguf> --runtime-file <zip>) [--request-id <id>] --json",
  "model preflight --request <request.json> --json",
  "model generate --request <request.json> --approve <sha256> --json",
];
const invalid = (message: string) =>
  new CliError(
    2,
    "BLK-CLI-002",
    message,
    "运行 command list --query model 或 schema show blocky.model-request/v2 查看格式。",
  );
export async function modelCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "model") return;
  signal.throwIfAborted();
  const action = args.words[1],
    command = `model.${action}`;
  if (action === "preflight" || action === "generate") {
    allow(
      args,
      action === "generate"
        ? ["request", "approve", "json"]
        : ["request", "json"],
      2,
    );
    const parsed = modelRequestSchema.safeParse(
      await readJsonArtifact(required(args, "request"), 262144),
    );
    if (!parsed.success)
      throw new CliError(
        3,
        "BLK-MODEL-REQUEST",
        "模型请求无效；仅支持资源引用及有界消息、工具和输出 Schema。",
        "运行 schema show blocky.model-request/v2；不要填写端点或凭据，检查 messages 的工具调用配对。",
      );
    const fields: Record<string, unknown> = { request: parsed.data };
    if (action === "generate") {
      const digest = required(args, "approve");
      if (!/^[a-f0-9]{64}$/.test(digest))
        throw invalid("--approve 必须是预检返回的 SHA256 摘要。");
      fields.approval = { approved: true, requestDigest: digest };
    }
    signal.throwIfAborted();
    const value = await nativeUserOperation(
      action === "generate"
        ? "provider-model-call"
        : "provider-model-preflight",
      fields,
      signal,
    );
    if (action === "generate") {
      const result = modelResponseSchema.safeParse(value);
      if (!result.success)
        throw new CliError(
          6,
          "BLK-MODEL-RESPONSE",
          "模型响应或用量格式无效。",
          "保留请求 ID，检查 Host 与 CLI 版本；不要把未知用量当作零。生成可能已发生，请勿自动重试。",
        );
      return {
        code: 0,
        result: envelope(command, {
          ...result.data,
          modelApiCalled: result.data.transport === "remote",
        }),
      };
    }
    return { code: 0, result: envelope(command, value) };
  }
  if (action === "catalog") {
    allow(args, ["json"], 2);
    return {
      code: 0,
      result: envelope(
        command,
        await nativeUserOperation("provider-local-model-catalog", {}, signal),
      ),
    };
  }
  if (!["status", "verify", "remove", "cleanup", "install"].includes(action))
    throw invalid("模型命令不存在。");
  allow(
    args,
    action === "install"
      ? [
          "backend",
          "download",
          "model-file",
          "runtime-file",
          "request-id",
          "json",
        ]
      : ["json"],
    3,
  );
  const id = modelIdSchema.safeParse(args.words[2]);
  if (!id.success)
    throw invalid("模型 ID 无效；请运行 model catalog 获取本机支持的模型。");
  const fields: Record<string, unknown> = { modelId: id.data };
  if (action === "install") {
    const backend = required(args, "backend");
    if (!["cpu", "vulkan"].includes(backend))
      throw invalid("--backend 仅支持 cpu 或 vulkan。");
    const download = args.options.get("download") === true;
    const hasModel = args.options.has("model-file"),
      hasRuntime = args.options.has("runtime-file");
    if (
      (download && (hasModel || hasRuntime)) ||
      (!download && (!hasModel || !hasRuntime))
    )
      throw invalid(
        "安装须选择 --download 或成对 --model-file/--runtime-file，不能混用。",
      );
    const requestId = args.options.has("request-id")
      ? required(args, "request-id")
      : `model-install-${randomUUID()}`;
    if (!modelIdSchema.safeParse(requestId).success)
      throw invalid("安装 request-id 必须是稳定 ID。");
    Object.assign(fields, { backend, requestId });
    if (!download)
      fields.source = {
        modelFile: resolve(required(args, "model-file")),
        runtimeFile: resolve(required(args, "runtime-file")),
      };
  }
  return {
    code: 0,
    result: envelope(
      command,
      await nativeUserOperation(
        `provider-local-model-${action}`,
        fields,
        signal,
      ),
    ),
  };
}
