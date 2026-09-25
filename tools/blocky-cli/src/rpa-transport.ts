import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { helper } from "./native-store";
import type { RpaPlan } from "@blocky/rpa-core";
import { CliError } from "./protocol";
export type RpaMessage = { schemaVersion: "blocky.rpa-session/v1"; type: string; value: Record<string, unknown> };
/** One private Host process owns this attended run and all of its worker Jobs. */
export function runNativeRpa(plan: RpaPlan, inputs: Record<string, string>, options: {
  signal: AbortSignal; onEvent(message: RpaMessage): void; controlStdin: boolean;
}): Promise<{ completed: boolean; code?: string; checkpoint?: unknown; readResults: unknown[] }> {
  options.signal.throwIfAborted();
  if (!existsSync(helper)) throw new CliError(6, "BLK-CLI-006", "原生组件未构建。", "运行 pnpm build:cli。");
  const initial = JSON.stringify({ schemaVersion: "blocky.rpa-session/v1", plan, inputs }) + "\n";
  if (Buffer.byteLength(initial) > 65536) throw new CliError(3, "BLK-RPA-LIMIT-001", "RPA 请求超出大小上限。");
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ["--blocky-rpa-run"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = "", controls = "", terminal: RpaMessage | undefined, checkpoint: unknown;
    const readResults: unknown[] = [];
    let fault: Error | undefined, stopTimer: ReturnType<typeof setTimeout> | undefined;
    const send = (operation: string) => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ operation }) + "\n"); };
    const stop = () => {
      send("stop");
      stopTimer ??= setTimeout(() => {
        fault = new CliError(6, "BLK-RPA-SETTLEMENT-001", "Host 未在期限内确认停止。", "检查目标窗口及剩余进程；不要自动重放副作用。");
        child.kill();
      }, 7000);
    };
    const fail = (error: Error) => { fault ??= error; stop(); };
    const control = (chunk: Buffer | string) => {
      controls += String(chunk);
      if (Buffer.byteLength(controls) > 4096) { fail(new CliError(3, "BLK-RPA-INPUT-001", "控制消息超限。")); return; }
      let end: number;
      while ((end = controls.indexOf("\n")) >= 0) {
        const line = controls.slice(0, end); controls = controls.slice(end + 1);
        try {
          const value = JSON.parse(line);
          if (!value || Object.keys(value).length !== 1 || !["pause", "resume", "stop", "status"].includes(value.operation)) throw Error();
          if (value.operation === "stop") stop(); else send(value.operation);
        } catch { fail(new CliError(3, "BLK-RPA-INPUT-001", "控制消息应只包含 pause、resume、stop 或 status 操作。")); }
      }
    };
    child.stdout.setEncoding("utf8"); child.stderr.resume();
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 131072) { fail(new CliError(6, "BLK-RPA-LIMIT-001", "Host 响应超限。")); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line) as RpaMessage;
          if (message.schemaVersion !== "blocky.rpa-session/v1" || typeof message.type !== "string" || !message.value || typeof message.value !== "object") throw Error();
          if (message.type === "checkpoint") checkpoint = message.value;
          if (message.type === "step.result") { if (readResults.length >= 100) throw Error(); readResults.push(message.value); }
          if (["run.completed", "run.failed"].includes(message.type)) terminal = message;
          options.onEvent(message);
        } catch { fail(new CliError(6, "BLK-RPA-WORKER-001", "Host 响应无效。")); }
      }
    });
    child.stdin.on("error", () => {});
    child.on("error", () => { fault = new CliError(6, "BLK-RPA-WORKER-001", "无法启动 RPA Host。"); });
    child.on("close", (exitCode) => {
      if (stopTimer) clearTimeout(stopTimer);
      options.signal.removeEventListener("abort", stop);
      if (options.controlStdin) { process.stdin.removeListener("data", control); process.stdin.removeListener("end", stop); process.stdin.pause(); }
      if (fault) { reject(fault); return; }
      if (!terminal || buffer.trim() || exitCode !== 0 && terminal.type === "run.completed") {
        reject(new CliError(6, "BLK-RPA-WORKER-001", "RPA Host 未返回完整结算结果。", "核对目标状态后再决定是否恢复。")); return;
      }
      resolve({ completed: terminal.type === "run.completed", code: typeof terminal.value.code === "string" ? terminal.value.code : undefined, checkpoint, readResults });
    });
    options.signal.addEventListener("abort", stop, { once: true });
    if (options.controlStdin) { process.stdin.on("data", control); process.stdin.once("end", stop); process.stdin.resume(); }
    child.stdin.write(initial);
    if (options.signal.aborted) stop();
  });
}
