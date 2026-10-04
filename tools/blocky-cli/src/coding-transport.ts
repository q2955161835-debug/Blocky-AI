import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { CliError } from "./protocol";
export type NativeCodingReply = {
  schemaVersion: "blocky.project-io/v1alpha1";
  ok: boolean;
  code?: string;
  value?: unknown;
};
/** Cancellation is cooperative: never terminate a Host in an atomic file
 * publication. Acknowledgment waits for the native receipt and process close. */
export function codingNativeRequest(
  executable: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<NativeCodingReply> {
  signal?.throwIfAborted();
  if (!existsSync(executable))
    throw new CliError(6, "BLK-CLI-006", "原生代码助手组件未构建。");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--blocky-coding-run"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "",
      bytes = 0,
      stopped = false,
      closed = false,
      failure: Error | undefined;
    const stop = () => {
      if (stopped || closed) return;
      stopped = true;
      child.stdin.end('{"cancel":true}\n');
    };
    const cancel = () => stop();
    const timer = setTimeout(stop, 86400000 + 10000);
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      bytes += Buffer.byteLength(part);
      if (bytes > 80 * 1024 * 1024) {
        failure ??= new CliError(
          6,
          "BLK-CODING-BUDGET",
          "代码助手回执超限，请核实工作目录文件。",
        );
        stop();
      } else output += part;
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      failure ??= new CliError(6, "BLK-HOST-001", "无法启动原生代码助手。");
    });
    child.on("close", (exitCode: number | null) => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (failure) {
        reject(failure);
        return;
      }
      try {
        const reply = JSON.parse(output) as NativeCodingReply;
        if (
          !reply ||
          typeof reply.ok !== "boolean" ||
          reply.schemaVersion !== "blocky.project-io/v1alpha1" ||
          Object.keys(reply).some(
            (key) => !["schemaVersion", "ok", "code", "value"].includes(key),
          ) ||
          exitCode === null ||
          (reply.ok ? exitCode !== 0 : exitCode === 0)
        )
          throw Error();
        resolve(reply);
      } catch {
        reject(
          new CliError(
            6,
            "BLK-CODING-SETTLE",
            "代码助手未返回有效结算回执，请核实工作目录文件。",
          ),
        );
      }
    });
    child.stdin.write(
      JSON.stringify({
        schemaVersion: "blocky.project-io/v1alpha1",
        ...input,
      }) + "\n",
    );
    if (signal?.aborted) stop();
  });
}
