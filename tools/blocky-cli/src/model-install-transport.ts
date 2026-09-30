import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { CliError } from "./protocol";

/** Wait for cooperative cleanup and process exit before acknowledging cancellation. */
export function installModel(
  executable: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  if (!existsSync(executable))
    throw new CliError(6, "BLK-CLI-006", "原生组件未构建。");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--blocky-model-install"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "",
      bytes = 0,
      failure: Error | undefined,
      forced = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.stdin.end('{"cancel":true}\n');
      grace = setTimeout(() => {
        forced = true;
        child.kill();
      }, 5000);
    };
    const cancel = () =>
      stop(
        new CliError(
          7,
          "BLK-RUN-005",
          "安装已停止。",
          "运行 model status 查看安装状态。",
        ),
      );
    const timer = setTimeout(
      () => stop(new CliError(6, "BLK-HOST-002", "模型安装超时。")),
      1_250_000,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      bytes += Buffer.byteLength(part);
      if (bytes > 65536)
        stop(new CliError(6, "BLK-HOST-001", "安装响应超限。"));
      else output += part;
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      failure ??= new CliError(6, "BLK-HOST-001", "无法启动模型安装。");
    });
    child.on("close", () => {
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener("abort", cancel);
      if (forced) {
        reject(
          new CliError(
            6,
            "BLK-LOCAL-MODEL-INTERRUPTED",
            "安装进程未能及时退出，已强制停止。",
            "运行 model status 检查；model cleanup 可清理经归属校验的安装临时文件。",
          ),
        );
      } else if (failure) reject(failure);
      else {
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(
            new CliError(6, "BLK-HOST-001", "安装响应无效，请查询模型状态。"),
          );
        }
      }
    });
    child.stdin.write(
      JSON.stringify({
        schemaVersion: "blocky.project-io/v1alpha1",
        ...input,
      }) + "\n",
    );
    if (signal?.aborted) cancel();
  });
}
