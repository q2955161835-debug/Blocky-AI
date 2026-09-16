import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeProject, decodeProject } from "@blocky/project-format";
import type { Project } from "@blocky/language-schema";
import { CliError } from "./protocol";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const helper = import.meta.url.endsWith("/main.mjs")
  ? resolve(
      dirname(fileURLToPath(import.meta.url)),
      "bin/blocky-project-io.exe",
    )
  : resolve(root, "apps/studio-host/target/release/blocky-project-io.exe");
type Reply = {
  schemaVersion: 'blocky.project-io/v1alpha1';
  ok: boolean;
  code?: string;
  files?: Record<string, string>;
  version?: string;
};
function request(input: Record<string,unknown>): Promise<Reply> {
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
    const timer = setTimeout(() => {
      child.kill();
      finish(new CliError(6, "BLK-HOST-002", "原生存储请求超时。"));
    }, 30000);
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      try {
        const reply = JSON.parse(stdout) as Reply;
        if (typeof reply.ok !== "boolean" || reply.schemaVersion !== 'blocky.project-io/v1alpha1') throw Error();
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
    child.stdin.end(JSON.stringify({schemaVersion:'blocky.project-io/v1alpha1',...input}));
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
