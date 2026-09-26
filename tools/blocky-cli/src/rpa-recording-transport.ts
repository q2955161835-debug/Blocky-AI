import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import {
  recordingReview,
  rpaRecordingControlSchema,
  rpaRecordingStopSchema,
  rpaRecordingStartSchema,
  type RpaRecordingStart,
  type RpaRecordingResult,
} from "@blocky/rpa-core/recording";
import { helper } from "./native-store";

const wire = "blocky.rpa-recording-session/v1";
const frameSchema = z
  .object({
    schemaVersion: z.literal(wire),
    sequence: z.number().int().min(1).max(2048),
    type: z.enum(["status", "recording", "settled"]),
    value: z.record(z.string(), z.unknown()),
  })
  .strict();
const statusSchema = z
  .object({
    sessionId: z.string(),
    state: z.enum(["awaiting-approval", "recording", "stopping", "stopped"]),
    count: z.number().int().min(0).max(100),
    omitted: z.number().int().min(0).max(10000).optional(),
    startedAt: z.number().int().nonnegative().optional(),
    expiresAt: z.number().int().nonnegative().optional(),
    reason: z
      .enum(["stopped", "limit", "expired", "target-lost", "capture-failed"])
      .optional(),
  })
  .strict();
const settlementSchema = z
  .object({
    settled: z.boolean(),
    code: z
      .string()
      .regex(/^BLK-RPA-[A-Z0-9-]+$/)
      .optional(),
  })
  .strict();
type Event = z.output<typeof frameSchema>;

/** One private Host owns consent and capture. Output is accepted only after exit and settlement. */
export function recordNativeRpa(
  input: RpaRecordingStart,
  options: {
    signal: AbortSignal;
    controlStdin: boolean;
    onEvent(message: Event): void;
  },
): Promise<RpaRecordingResult | null> {
  options.signal.throwIfAborted();
  const request = rpaRecordingStartSchema.parse(input);
  if (!existsSync(helper)) throw Error("BLK-RPA-WORKER-001");
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ["--blocky-rpa-record"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let buffer = "",
      controls = "",
      sequence = 0,
      controlCount = 0,
      stopping = false,
      closed = false,
      terminal = false;
    let result: RpaRecordingResult | null | undefined,
      settled = false,
      fault: Error | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined,
      killTimer: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const lifetime = setTimeout(() => fail("BLK-RPA-TIMEOUT-001"), 915000);
    const send = (operation: "status" | "stop") => {
      if (!child.stdin.destroyed)
        child.stdin.write(JSON.stringify({ operation }) + "\n");
    };
    const cleanup = () => {
      clearTimeout(lifetime);
      clearTimeout(idle);
      clearTimeout(stopTimer);
      clearTimeout(killTimer);
      options.signal.removeEventListener("abort", stop);
      if (options.controlStdin) {
        process.stdin.removeListener("data", control);
        process.stdin.removeListener("end", end);
        process.stdin.pause();
      }
    };
    const stop = () => {
      if (stopping || closed) return;
      stopping = true;
      send("stop");
      stopTimer = setTimeout(() => {
        fault = Error("BLK-RPA-SETTLEMENT-001");
        child.kill();
        killTimer = setTimeout(() => {
          if (closed) return;
          closed = true;
          cleanup();
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          reject(fault);
        }, 500);
      }, 7000);
    };
    const fail = (code: string) => {
      fault ??= Error(code);
      stop();
    };
    const heartbeat = (approval = false) => {
      clearTimeout(idle);
      idle = setTimeout(
        () => fail("BLK-RPA-TIMEOUT-001"),
        approval ? 310000 : 15000,
      );
    };
    const control = (chunk: Buffer | string) => {
      if (stopping) return;
      controls += String(chunk);
      if (Buffer.byteLength(controls) > 4096) {
        fail("BLK-RPA-INPUT-001");
        return;
      }
      let end: number;
      while ((end = controls.indexOf("\n")) >= 0) {
        const line = controls.slice(0, end);
        controls = controls.slice(end + 1);
        try {
          const value = rpaRecordingControlSchema.parse(JSON.parse(line));
          if (++controlCount > 1024) throw Error();
          if (value.operation === "stop") {
            stop();
            return;
          }
          send("status");
        } catch {
          fail("BLK-RPA-INPUT-001");
          return;
        }
      }
    };
    const end = () => {
      if (controls.trim()) fail("BLK-RPA-INPUT-001");
      else stop();
    };
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: string) => {
      if (closed || fault) return;
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          if (Buffer.byteLength(line) > 65536 || terminal) throw Error();
          const message = frameSchema.parse(JSON.parse(line));
          if (message.sequence !== ++sequence) throw Error();
          if (message.type === "status") {
            if (result !== undefined) throw Error();
            const status = statusSchema.parse(message.value);
            if (status.sessionId !== request.sessionId) throw Error();
            heartbeat(status.state === "awaiting-approval");
          } else if (message.type === "recording") {
            if (result !== undefined) throw Error();
            const stopped = rpaRecordingStopSchema.parse(message.value);
            if (stopped.sessionId !== request.sessionId) throw Error();
            if (stopped.recording) {
              const capture = stopped.recording;
              if (
                capture.sessionId !== request.sessionId ||
                capture.projectId !== request.projectId ||
                capture.target.kind !== request.target.kind ||
                (request.target.kind === "windows" &&
                  capture.target.identity !== request.target.identity)
              )
                throw Error();
              if (capture.actions.length) recordingReview(capture, request);
            }
            result = stopped.recording;
            heartbeat();
          } else {
            const value = settlementSchema.parse(message.value);
            terminal = true;
            settled = value.settled;
            if (!settled) fault = Error("BLK-RPA-SETTLEMENT-001");
            else if (value.code) fault = Error(value.code);
            heartbeat();
          }
          options.onEvent(message);
        } catch {
          fail("BLK-RPA-WORKER-001");
          return;
        }
      }
      if (Buffer.byteLength(buffer) > 65536) fail("BLK-RPA-LIMIT-001");
    });
    child.on("error", () => fail("BLK-RPA-WORKER-001"));
    child.on("close", (exitCode) => {
      if (closed) return;
      closed = true;
      cleanup();
      if (fault) reject(fault);
      else if (
        buffer.trim() ||
        exitCode !== 0 ||
        !terminal ||
        !settled ||
        result === undefined
      )
        reject(Error("BLK-RPA-WORKER-001"));
      else resolve(result);
    });
    child.stdin.write(JSON.stringify({ schemaVersion: wire, request }) + "\n");
    heartbeat(true);
    options.signal.addEventListener("abort", stop, { once: true });
    if (options.controlStdin) {
      process.stdin.on("data", control);
      process.stdin.once("end", end);
      process.stdin.resume();
      if (process.stdin.readableEnded) end();
    }
    if (options.signal.aborted) stop();
  });
}
