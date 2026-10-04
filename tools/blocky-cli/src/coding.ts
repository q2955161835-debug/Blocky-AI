import { z } from "zod";
import { createHash } from "node:crypto";
import {
  codingChangeSchema,
  codingResultSchema,
  parseCodingStart,
} from "@blocky/builder-protocol";
import { agentMessageLimits, canonicalJson, stableId } from "@blocky/language-schema";
import { allow, required, type Args } from "./arguments";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { nativeUserOperation, readProject } from "./native-store";
import { readDefaultModelId } from "./user-config";
import { CliError, envelope } from "./protocol";
const id = z.string().regex(stableId).max(200);
export const codingFailureSchema = z
  .object({
    schemaVersion: z.literal("blocky.coding-failure/v1"),
    requestId: id,
    projectId: id,
    baseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    code: z
      .string()
      .regex(/^BLK-[A-Z0-9-]+$/)
      .max(128),
    changes: z
      .array(codingChangeSchema)
      .max(512)
      .refine(
        (changes) =>
          new Set(changes.map((c) => c.changeId)).size === changes.length &&
          Buffer.byteLength(JSON.stringify(changes)) <= 64 * 1024 * 1024,
      ),
    modelApiCalled: z.boolean(),
  })
  .strict();
// Native transport caps receipts at80MiB. Base64 expands at most4/3; chunks
// stay below the display sanitizer's16KiB text bound. Joining these chunks and
// decoding Base64 restores exact UTF-8 JSON even if the readable receipt changes.
function recoveryData(receipt: unknown) {
  const bytes = Buffer.from(JSON.stringify(receipt), "utf8");
  const encoded = bytes.toString("base64");
  const receiptJsonBase64: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += 12000)
    receiptJsonBase64.push(encoded.slice(offset, offset + 12000));
  return {
    receipt,
    receiptJsonBase64,
    receiptSha256: createHash("sha256").update(bytes).digest("hex"),
    applied: false,
  };
}
export const codingHelp = [
  "coding run <file.blocky> --module <id> --prompt <text> [--model <resource-id>] [--request-id <id>] [--conversation <messages.json>] [--blocks <id,id>] [--workspace] --output <result-or-failure.json> --json",
];
export async function codingCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "coding") return;
  if (args.words[1] !== "run")
    throw new CliError(2, "BLK-CLI-002", "代码助手命令不存在。");
  allow(
    args,
    [
      "module",
      "prompt",
      "model",
      "request-id",
      "conversation",
      "blocks",
      "workspace",
      "output",
      "json",
    ],
    3,
  );
  const output = required(args, "output");
  const project = await readProject(args.words[2]);
  const resourceId = args.options.has("model")
    ? required(args, "model")
    : await readDefaultModelId();
  if (!resourceId)
    throw new CliError(
      3,
      "BLK-MODEL-DEFAULT-001",
      "请先配置默认模型或使用 --model 选择模型。",
    );
  try {
    const start = parseCodingStart({
      schemaVersion: "blocky.coding-start/v1",
      requestId:
        args.options.get("request-id") ?? `coding-${crypto.randomUUID()}`,
      projectId: project.manifest.projectId,
      moduleId: required(args, "module"),
      prompt: required(args, "prompt"),
      originalJson: canonicalJson(project),
      resourceId,
      selection: String(args.options.get("blocks") ?? "")
        .split(",")
        .filter(Boolean),
      conversation: args.options.has("conversation")
        ? await readJsonArtifact(required(args, "conversation"), agentMessageLimits.historyBytes)
        : [],
    });
    const raw = await nativeUserOperation(
      "coding-run",
      { start, pickWorkspace: args.options.has("workspace") },
      signal,
    );
    const baseDigest = createHash("sha256")
      .update(start.originalJson)
      .digest("hex");
    const bind = (value: {
      requestId: string;
      projectId: string;
      baseDigest: string;
    }) => {
      if (
        value.requestId !== start.requestId ||
        value.projectId !== start.projectId ||
        value.baseDigest !== baseDigest
      )
        throw Error("BLK-CODING-WIRE");
    };
    let failed: z.infer<typeof codingFailureSchema> | undefined;
    if (
      (raw as { schemaVersion?: unknown })?.schemaVersion ===
      "blocky.coding-failure/v1"
    )
      failed = codingFailureSchema.parse(raw);
    else if (signal.aborted) {
      const result = codingResultSchema.parse(raw);
      bind(result);
      failed = codingFailureSchema.parse({
        schemaVersion: "blocky.coding-failure/v1",
        requestId: result.requestId,
        projectId: result.projectId,
        baseDigest: result.baseDigest,
        code: "BLK-CODING-CANCELLED",
        changes: result.changes,
        modelApiCalled: result.modelApiCalled,
      });
    }
    if (failed) {
      bind(failed);
      const response = envelope("coding.run", {
        requestId: failed.requestId,
        projectId: failed.projectId,
        modelApiCalled: failed.modelApiCalled,
        changes: failed.changes.length,
        applied: false,
      });
      response.ok = false;
      response.error = {
        code: failed.code,
        message: "代码助手任务未完成；文件实际变更已保留在回执中。",
        path: "",
        hint: "检查输出回执中的 changes，并核实工作目录文件。",
      };
      try {
        response.artifacts = [await writeJsonArtifact(output, failed)];
      } catch {
        response.data = recoveryData(failed);
        response.error = {
          code: "BLK-SAVE-001",
          message: "任务未完成，回执文件无法写入；实际变更已保留在当前输出中。",
          path: "",
          hint: "保存当前 JSON 输出；连接 receiptJsonBase64 数组并解码，核对 receiptSha256 后检查 changes。",
        };
        return { code: 6, result: response };
      }
      return {
        code: /CANCELLED|TIMEOUT$/.test(failed.code) ? 7 : 3,
        result: response,
      };
    }
    const result = codingResultSchema.parse(raw);
    bind(result);
    const response = envelope("coding.run", {
      requestId: result.requestId,
      projectId: result.projectId,
      modelApiCalled: result.modelApiCalled,
      changes: result.changes.length,
      applied: false,
    });
    try {
      response.artifacts = [await writeJsonArtifact(output, result)];
    } catch {
      response.ok = false;
      response.data = recoveryData(result);
      response.error = {
        code: "BLK-SAVE-001",
        message: "回执文件无法写入；实际变更和任务结果已保留在当前输出中。",
        path: "",
        hint: "保存当前 JSON 输出；连接 receiptJsonBase64 数组并解码，核对 receiptSha256 后检查 changes。",
      };
      return { code: 6, result: response };
    }
    return { code: 0, result: response };
  } catch (error) {
    if (error instanceof CliError) throw error;
    const code =
      error instanceof Error && /^BLK-[A-Z0-9-]+$/.test(error.message)
        ? error.message
        : "BLK-CODING-INPUT";
    throw new CliError(
      signal.aborted ? 7 : 3,
      code,
      "代码助手任务未完成；请检查回执、模型、项目和工作目录授权。",
    );
  }
}
