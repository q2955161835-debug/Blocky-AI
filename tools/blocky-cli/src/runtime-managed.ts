import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { helper } from "./native-store";
import { CliError, envelope } from "./protocol";
import { workflowErrorCode } from "./workflow-errors";
import { errorGuidance } from "./error-guidance";
const MAX = 20 * 1024 * 1024;
export async function managedRun(
  argv: string[],
  write: (value: unknown) => void,
  signal: AbortSignal,
): Promise<{ code: number; result: ReturnType<typeof envelope> }> {
  signal.throwIfAborted();
  const child = spawn(helper, ["--blocky-runtime-session"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "",
    total = 0,
    terminal = false,
    result: any,
    problem: Error | undefined,
    cancelled = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectRun: ((error: Error) => void) | undefined,
    terminated = false;
  let prompt: ReturnType<typeof createInterface> | undefined;
  const send = (value: unknown) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const failure = () =>
    new CliError(
      signal.aborted ? 7 : 6,
      signal.aborted ? "BLK-RUN-005" : "BLK-WORKFLOW-CHANNEL",
      signal.aborted
        ? "停止请求未确认，请核对工作流状态。"
        : "受控运行通道失败，请核对工作流状态。",
    );
  const fail = () => {
    if (terminated) return;
    terminated = true;
    problem ??= failure();
    child.kill();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    rejectRun?.(problem);
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    prompt?.close();
    send({ kind: "cancel" });
    cancelTimer = setTimeout(fail, 12000);
  };
  const deadline = setTimeout(fail, 325000);
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  child.stderr.resume();
  child.stdin.on("error", fail);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    try {
      total += Buffer.byteLength(chunk);
      buffer += chunk;
      if (total > 256 * 1024 * 1024 || Buffer.byteLength(buffer) > MAX)
        throw Error();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (terminal || !frame || typeof frame !== "object") throw Error();
        if (
          frame.kind === "output" &&
          Object.keys(frame).sort().join() === "kind,value"
        )
          write(frame.value);
        else if (
          frame.kind === "done" &&
          Object.keys(frame).sort().join() === "kind,value"
        ) {
          if (
            !frame.value ||
            Object.keys(frame.value).sort().join() !== "code,result" ||
            !Number.isInteger(frame.value.code) ||
            frame.value.code < 0 ||
            frame.value.code > 255 ||
            frame.value.result?.schemaVersion !== "blocky.cli/v1"
          )
            throw Error();
          terminal = true;
          result = frame.value;
        } else if (
          frame.kind === "error" &&
          Object.keys(frame).sort().join() === "code,kind"
        ) {
          const code = workflowErrorCode(frame.code),
            guidance = errorGuidance(code);
          problem = signal.aborted
            ? failure()
            : new CliError(
                6,
                code,
                guidance?.message ?? "受控运行未完成，请核对工作流状态。",
                guidance?.hint,
              );
          terminal = true;
        } else if (
          frame.kind === "approval" &&
          Object.keys(frame).sort().join() === "id,kind,value" &&
          Number.isSafeInteger(frame.id) &&
          !prompt &&
          /^[a-f0-9]{64}$/.test(frame.value?.requestDigest)
        ) {
          write(envelope("run.approval-required", frame.value));
          prompt = createInterface({
            input: process.stdin,
            output: process.stderr,
            terminal: false,
          });
          const current = prompt;
          void current
            .question("输入该请求的完整摘要以批准，其他输入拒绝：\n", {
              signal,
            })
            .then(
              (answer) => {
                send({
                  kind: "approval",
                  id: frame.id,
                  value: answer.trim() === frame.value.requestDigest,
                });
              },
              () => {
                if (!cancelled)
                  send({ kind: "approval", id: frame.id, value: false });
              },
            )
            .finally(() => {
              current.close();
              prompt = undefined;
            });
        } else throw Error();
      }
    } catch {
      fail();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      rejectRun = reject;
      child.on("error", () => {
        problem = failure();
        reject(problem);
      });
      child.on("close", (code) => {
        if (code !== 0 || !terminal || buffer.trim() || !result || problem)
          reject(problem ?? failure());
        else resolve();
      });
      send({ kind: "start", schemaVersion: "blocky.runtime-session/v1", argv });
    });
    return result;
  } finally {
    clearTimeout(deadline);
    clearTimeout(cancelTimer);
    signal.removeEventListener("abort", cancel);
    prompt?.close();
    child.stdin.destroy();
  }
}
