import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeProject, decodeProject } from "@blocky/project-format";
import type { Project } from "@blocky/language-schema";
import { canonicalJson } from "@blocky/language-schema";
import { CliError } from "./protocol";
import { errorGuidance } from "./error-guidance";
import { KnowledgeTransport } from "./knowledge-transport";
import { installModel } from "./model-install-transport";
import { codingNativeRequest } from "./coding-transport";
import { cooperativeNativeRequest } from "./cooperative-transport";
import { WorkspaceTransport } from "./workspace-transport";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const helper = /\/(?:main|runtime-worker)\.mjs$/.test(import.meta.url)
  ? resolve(
      dirname(fileURLToPath(import.meta.url)),
      "bin/blocky-project-io.exe",
    )
  : resolve(root, "tools/blocky-cli/dist/bin/blocky-project-io.exe");
const knowledgeTransport = new KnowledgeTransport(helper);
export const workspaceTransport = new WorkspaceTransport(helper);
export const closeNativeKnowledge = async () => { await Promise.all([knowledgeTransport.close(), workspaceTransport.close()]); };
type Reply = {
  schemaVersion: "blocky.project-io/v1alpha1";
  ok: boolean;
  code?: string;
  files?: Record<string, string>;
  version?: string;
  project?: Project;
  value?: unknown;
};
function request(
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Reply> {
  signal?.throwIfAborted();
  if (!existsSync(helper))
    throw new CliError(
      6,
      "BLK-CLI-006",
      "原生项目存储未构建。",
      "从仓库运行 pnpm build:cli，或重新安装包含原生组件的发行包。",
    );
  return new Promise((done, reject) => {
    const child = spawn(helper, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "",
      size = 0,
      finished = false;
    const timer = setTimeout(
      () => {
        child.kill();
        finish(new CliError(6, "BLK-HOST-002", "原生存储请求超时。"));
      },
      String(input.operation).startsWith("coding-")
        ? 310000
        : /^(conversion-|provider-|builder-)/.test(String(input.operation))
          ? 130000
          : 30000,
    );
    const cancel = () => {
      child.kill();
      finish(new CliError(7, "BLK-RUN-005", "已停止"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) {
        reject(error);
        return;
      }
      try {
        const reply = JSON.parse(stdout) as Reply;
        if (
          typeof reply.ok !== "boolean" ||
          reply.schemaVersion !== "blocky.project-io/v1alpha1"
        )
          throw Error();
        done(reply);
      } catch {
        reject(new CliError(6, "BLK-HOST-001", "原生存储响应无效。"));
      }
    }
    child.on("error", () =>
      finish(new CliError(6, "BLK-HOST-001", "无法启动原生存储。")),
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > 20 * 1024 * 1024) {
        child.kill();
        finish(new CliError(6, "BLK-HOST-001", "原生存储响应超限。"));
      } else stdout += chunk;
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("close", () => finish());
    child.stdin.end(
      JSON.stringify({ schemaVersion: "blocky.project-io/v1alpha1", ...input }),
    );
  });
}
export async function doctor() {
  const result = await request({ operation: "version" });
  if (!result.ok) throw new CliError(6, "BLK-HOST-001", "原生存储不可用。");
  return result.version;
}
export async function readProject(path: string): Promise<Project> {
  const reply = await request({ operation: "read", path: resolve(path) });
  if (!reply.ok || !reply.files)
    throw new CliError(3, "BLK-LOAD-001", "项目文件无法读取或未通过边界检查。");
  try {
    return decodeProject(reply.files);
  } catch {
    throw new CliError(3, "BLK-REF-001", "项目事实不符合当前格式。");
  }
}
export async function nativeUserOperation(
  operation: string,
  fields: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (operation === "workspace-call") return workspaceTransport.call(fields.request, signal);
  if (operation === "workspace-status") return workspaceTransport.status(String(fields.projectId));
  if (operation === "coding-cancel") { workspaceTransport.cancel(String(fields.requestId)); return null; }
  // A timed-out inference must not hold up the final ACL check or the fallback.
  // The session is privately owned by this CLI; the next request starts afresh.
  if (operation === "knowledge-cancel") knowledgeTransport.cancel();
  const reply = (
    operation === "coding-run"
      ? await codingNativeRequest(helper, { operation, ...fields }, signal)
      : operation === "tool-call"
        ? await cooperativeNativeRequest(
            helper,
            { operation, ...fields },
            "tool-call",
            signal,
          )
        : operation === "provider-local-model-install"
          ? await installModel(helper, { operation, ...fields }, signal)
          : operation.startsWith("knowledge-") &&
              operation !== "knowledge-cancel"
            ? await knowledgeTransport.request({ operation, ...fields })
            : await request({ operation, ...fields }, signal)
  ) as Reply;
  if (
    reply.schemaVersion !== "blocky.project-io/v1alpha1" ||
    typeof reply.ok !== "boolean"
  )
    throw new CliError(6, "BLK-HOST-001", "原生响应格式无效。");
  if (!reply.ok && operation === "coding-run" && reply.value != null)
    return reply.value;
  if (!reply.ok)
    throw new CliError(
      3,
      reply.code ?? "BLK-SET-001",
      operation.startsWith("knowledge-")
        ? "资料操作失败，请检查来源与权限。"
        : operation.startsWith("conversion-")
          ? "仓库转换操作失败，请检查版本、目录、工件与预算。"
          : (errorGuidance(reply.code ?? "")?.message ??
            (operation.startsWith("builder-") || operation.startsWith("coding-")
              ? "构建操作未完成；原项目保持不变。"
              : "本机配置操作失败，未返回秘密内容。")),
      errorGuidance(reply.code ?? "")?.hint,
    );
  return reply.value;
}
export async function readMigration(
  path: string,
): Promise<Record<string, string>> {
  const reply = await request({
    operation: "read-migration",
    path: resolve(path),
  });
  if (!reply.ok || !reply.files)
    throw new CliError(3, "BLK-MIG-001", "迁移源文件未通过原生边界检查。");
  return reply.files;
}
export async function createProject(path: string, project: Project) {
  const reply = await request({
    operation: "create",
    path: resolve(path),
    files: encodeProject(project),
  });
  if (!reply.ok) {
    if (reply.code === "BLK-CONFLICT-001")
      throw new CliError(
        5,
        reply.code,
        "目标已经存在，未覆盖任何内容。",
        "选择新的 --output 文件。",
      );
    throw new CliError(
      3,
      "BLK-SAVE-001",
      "项目未写入，请检查目标目录和输入格式。",
    );
  }
}
export async function validatePatch(
  project: Project,
  patch: unknown,
  approved: string[],
) {
  const reply = await request({
    operation: "validate-patch",
    originalJson: canonicalJson(project),
    patch,
    approved,
  });
  if (!reply.ok || !reply.project)
    throw new CliError(
      reply.code === "BLK-PATCH-001" ? 5 : 3,
      reply.code ?? "BLK-PATCH-002",
      "原生补丁校验失败。",
    );
  return reply.project;
}
export async function applyProjectPatch(
  source: string,
  path: string,
  project: Project,
  patch: unknown,
  approved: string[],
) {
  const reply = await request({
    operation: "apply-patch",
    source: resolve(source),
    path: resolve(path),
    originalJson: canonicalJson(project),
    patch,
    approved,
  });
  if (!reply.ok)
    throw new CliError(
      ["BLK-CONFLICT-001", "BLK-PATCH-001"].includes(reply.code ?? "") ? 5 : 3,
      reply.code ?? "BLK-PATCH-002",
      "原生补丁未写入，原项目保留。",
    );
}
