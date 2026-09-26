import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { helper } from "./native-store";
import {
  readRpaResult,
  type RpaModuleHandle,
  type RpaModulePorts,
  type RpaModulePlan,
} from "@blocky/rpa-core";

const wire = "blocky.rpa-module-session/v1";
const frame = z
  .object({
    schemaVersion: z.literal(wire),
    type: z.enum(["ready", "result", "error", "settled"]),
    requestId: z.number().int().min(0).max(100),
    value: z.record(z.string(), z.unknown()),
  })
  .strict();
const failure = (value: unknown, fallback = "BLK-RPA-WORKER-001") =>
  Error(
    typeof value === "string" && /^BLK-RPA-[A-Z0-9-]+$/.test(value)
      ? value
      : fallback,
  );

/** No public attach/eval interface: a fresh private Host owns exactly one approved plan. */
async function open(
  request: RpaModulePlan,
  signal: AbortSignal,
): Promise<RpaModuleHandle> {
  signal.throwIfAborted();
  if (!existsSync(helper)) throw Error("BLK-RPA-WORKER-001");
  const initial =
    JSON.stringify({
      schemaVersion: wire,
      plan: request.plan,
      ...(request.browser ? { browser: request.browser } : {}),
    }) + "\n";
  if (Buffer.byteLength(initial) > 65536) throw Error("BLK-RPA-LIMIT-001");
  const child = spawn(helper, ["--blocky-rpa-module"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "",
    serial = 0,
    closing = false,
    closed = false,
    settled = false,
    terminal = false,
    receivedReady = false,
    fault: Error | undefined;
  let pending:
    | {
        id: number;
        resolve: (value: { text?: string }) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let readyResolve!: (id: string) => void, readyReject!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let exitResolve!: () => void;
  const exit = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const send = (value: unknown) => {
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + "\n");
  };
  const stop = () => {
    if (closing || closed) return;
    closing = true;
    send({ operation: "close" });
    stopTimer = setTimeout(() => {
      fault = Error("BLK-RPA-SETTLEMENT-001");
      child.kill();
      // A failed kill or missing close event cannot leave the caller waiting forever.
      killTimer = setTimeout(() => {
        if (closed) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        readyReject(fault!); pending?.reject(fault!); pending = undefined;
        exitResolve(); // Unconfirmed: close() still throws; this is never a settlement receipt.
      }, 500);
    }, 7000);
  };
  const fail = (error: Error) => {
    fault ??= error;
    stop();
  };
  const timer = setTimeout(() => fail(Error("BLK-RPA-TIMEOUT-001")), 130000);
  child.stdout.setEncoding("utf8");
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 65536) {
      fail(Error("BLK-RPA-LIMIT-001"));
      return;
    }
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const message = frame.parse(JSON.parse(line));
        if (terminal) throw Error();
        if (message.type === "ready") {
          if (
            receivedReady ||
            serial !== 0 ||
            message.requestId !== 0 ||
            typeof message.value.checkpointId !== "string" ||
            !/^checkpoint-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
              message.value.checkpointId,
            ) ||
            message.value.checkpointId.length > 80
          )
            throw Error();
          receivedReady = true;
          readyResolve(message.value.checkpointId);
        } else if (message.type === "settled") {
          if (
            message.requestId !== 0 ||
            typeof message.value.settled !== "boolean"
          )
            throw Error();
          terminal = true;
          settled = message.value.settled;
          if (!settled) fault = Error("BLK-RPA-SETTLEMENT-001");
          const error = failure(message.value.code, "BLK-RPA-CANCELLED");
          readyReject(error);
          pending?.reject(error);
          pending = undefined;
        } else {
          if (!pending || pending.id !== message.requestId) throw Error();
          const current = pending;
          if (message.type === "error")
            current.reject(failure(message.value.code));
          else current.resolve(readRpaResult(message.value));
          pending = undefined;
        }
      } catch {
        fail(Error("BLK-RPA-WORKER-001"));
      }
    }
  });
  child.on("error", () => {
    fail(Error("BLK-RPA-WORKER-001"));
  });
  child.on("close", () => {
    closed = true;
    clearTimeout(timer);
    if (stopTimer) clearTimeout(stopTimer);
    if (killTimer) clearTimeout(killTimer);
    signal.removeEventListener("abort", stop);
    if (!terminal || !settled || buffer.trim())
      fault ??= Error("BLK-RPA-SETTLEMENT-001");
    readyReject(fault ?? Error("BLK-RPA-CANCELLED"));
    pending?.reject(fault ?? Error("BLK-RPA-CANCELLED"));
    pending = undefined;
    exitResolve();
  });
  const close = async () => {
    stop();
    await exit;
    if (fault) throw fault;
  };
  signal.addEventListener("abort", stop, { once: true });
  child.stdin.write(initial);
  if (signal.aborted) stop();
  try {
    const checkpointId = await ready;
    signal.throwIfAborted();
    return {
      checkpointId,
      close,
      perform: async (step, input, stepSignal) => {
        stepSignal.throwIfAborted();
        if (closing || closed || pending || ++serial > 100)
          throw Error("BLK-RPA-STATE-001");
        return new Promise<{ text?: string }>((resolve, reject) => {
          pending = { id: serial, resolve, reject };
          send({
            operation: "step",
            requestId: serial,
            stepId: step.stepId,
            manualInput: input ?? null,
          });
        });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export function cliRpaModules(inputs: Record<string, string>): RpaModulePorts {
  return {
    open,
    manualInput: async (source, signal) => {
      signal.throwIfAborted();
      const value = inputs[`${source.moduleId}/${source.blockId}`];
      if (typeof value !== "string") throw Error("BLK-RPA-INPUT-002");
      return value;
    },
  };
}
