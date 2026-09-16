import { spawn } from "node:child_process";
import { helper, readProject } from "./native-store";
import { encodeProject } from "@blocky/project-format";
import {
  parseTaskRequest,
  taskDefinition,
  type TaskRequest,
  type TaskSnapshot,
} from "@blocky/terminal-protocol";
import { type Project } from "@blocky/language-schema";
import { type Args, allow, integer } from "./arguments";
import { CliError, envelope } from "./protocol";
export const taskHelp = [
  "task list --json",
  "task run <file.blocky> [--passes 5] [--interval 100] [--timeout 30000] [--output-budget 65536] --json",
];
export function runNativeTask(
  project: Project,
  request: TaskRequest,
  signal: AbortSignal,
): Promise<TaskSnapshot> {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ["--blocky-task-run"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let buffer = "",
      last: TaskSnapshot | undefined,
      errorCode = "",
      settled = false;
    const timer = setTimeout(() => {
      child.kill();
    }, request.timeoutMs + 5000);
    const cancel = () => child.stdin.end("cancel\n");
    signal.addEventListener("abort", cancel, { once: true });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else if (last && last.activeProcesses === 0) resolve(last);
      else
        reject(
          new CliError(3, errorCode || "BLK-TERM-001", "任务进程未完成结算。"),
        );
    };
    child.on("error", () =>
      finish(new CliError(6, "BLK-CLI-006", "无法启动原生任务组件。")),
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 512 * 1024) {
        child.kill();
        finish(new CliError(3, "BLK-TERM-104", "任务响应超限。"));
        return;
      }
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const value = JSON.parse(line);
          if (value.schemaVersion === "blocky.task-error/v1alpha1")
            errorCode = value.code;
          else if (
            value.schemaVersion === "blocky.task-result/v1alpha1" &&
            [
              "starting",
              "running",
              "exited",
              "failed",
              "cancelled",
              "timed-out",
            ].includes(value.status)
          )
            last = value;
          else throw Error();
        } catch {
          child.kill();
          finish(new CliError(3, "BLK-TERM-104", "任务响应无效。"));
        }
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("close", () => finish());
    child.stdin.write(
      JSON.stringify({ request, files: encodeProject(project) }) + "\n",
    );
    if (signal.aborted) cancel();
  });
}
export async function taskCommand(args: Args, signal: AbortSignal) {
  const command = args.words.slice(0, 2).join(".");
  if (command === "task.list") {
    allow(args, ["json"], 2);
    return { code: 0, result: envelope(command, [taskDefinition]) };
  }
  if (command !== "task.run") return;
  allow(args, ["json", "passes", "interval", "timeout", "output-budget"], 3);
  const interval = args.options.get("interval") ?? "100";
  if (
    typeof interval !== "string" ||
    !/^\d+$/.test(interval) ||
    Number(interval) > 1000
  )
    throw new CliError(2, "BLK-TERM-101", "间隔超出范围。");
  const request = parseTaskRequest({
    taskId: taskDefinition.taskId,
    parameters: {
      passes: integer(args, "passes", 5, 360),
      "interval-ms": Number(interval),
    },
    timeoutMs: integer(args, "timeout", 30000, 30000),
    outputBudgetBytes: integer(args, "output-budget", 65536, 65536),
  });
  const project = await readProject(args.words[2]);
  const state = await runNativeTask(project, request, signal);
  const code =
    state.status === "exited"
      ? 0
      : ["timed-out", "cancelled"].includes(state.status)
        ? 7
        : 3;
  const result = envelope(command, state);
  result.ok = code === 0;
  return { code, result };
}
