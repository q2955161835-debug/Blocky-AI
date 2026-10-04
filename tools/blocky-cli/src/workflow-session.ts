import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  parseWorkflow,
  assertWorkflowBinding,
  type WorkflowPorts,
  type WorkflowRecord,
} from "@blocky/runtime-core";
import { helper } from "./native-store";

const WIRE = "blocky.workflow-session/v1",
  MAX = 20 * 1024 * 1024;
const codes = new Set(
  [
    "INVALID",
    "LIMIT",
    "STORE",
    "OWNER",
    "BINDING",
    "CONFLICT",
    "UNCERTAIN",
    "STATE",
    "NOT-FOUND",
    "CHANNEL",
    "CANCELLED",
  ].map((code) => `BLK-WORKFLOW-${code}`),
);
const failure = (code?: unknown) =>
  Error(
    typeof code === "string" && codes.has(code) ? code : "BLK-WORKFLOW-CHANNEL",
  );

/** A private, run-long ledger session. Its exit never asserts settlement of external effects. */
export function cliWorkflowPorts(): WorkflowPorts {
  return {
    open: async (request, signal) => {
      signal.throwIfAborted();
      if (!existsSync(helper)) throw failure("BLK-WORKFLOW-CHANNEL");
      const initial =
        JSON.stringify({ schemaVersion: WIRE, ...request }) + "\n";
      if (Buffer.byteLength(initial) > MAX) throw failure("BLK-WORKFLOW-LIMIT");
      const child = spawn(helper, ["--blocky-workflow-session"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let buffer = "",
        serial = 0,
        ended = false,
        terminal = false,
        readyReceived = false,
        fault: Error | undefined;
      let taskId = "",
        exitCode: number | null = null;
      let pending:
        | {
            id: number;
            operation: string;
            settlement: boolean;
            drained: () => void;
            resolve: (v: unknown) => void;
            reject: (e: Error) => void;
          }
        | undefined;
      let drained = Promise.resolve();
      let readyResolve!: () => void,
        readyReject!: (e: Error) => void,
        exitResolve!: () => void;
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      const exit = new Promise<void>((resolve) => {
        exitResolve = resolve;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: Error) => {
        fault ??= error;
        clearTimeout(timer);
        readyReject(fault);
        pending?.reject(fault);
        pending?.drained();
        pending = undefined;
        if (!ended) child.kill();
      };
      const deadline = (milliseconds = 10000) => {
        clearTimeout(timer);
        timer = setTimeout(
          () => fail(failure("BLK-WORKFLOW-CHANNEL")),
          milliseconds,
        );
      };
      const send = (value: unknown) => {
        const bytes = JSON.stringify(value) + "\n";
        if (Buffer.byteLength(bytes) > MAX) {
          fail(failure("BLK-WORKFLOW-LIMIT"));
          return;
        }
        child.stdin.write(bytes, (error) => {
          if (error) fail(failure("BLK-WORKFLOW-CHANNEL"));
        });
      };
      child.stdin.on("error", () => fail(failure("BLK-WORKFLOW-CHANNEL")));
      child.stderr.resume();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > MAX) {
          fail(failure("BLK-WORKFLOW-LIMIT"));
          return;
        }
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const frame = JSON.parse(line);
            if (
              terminal ||
              !frame ||
              Object.keys(frame).sort().join() !==
                "requestId,schemaVersion,type,value" ||
              frame.schemaVersion !== WIRE ||
              !Number.isSafeInteger(frame.requestId) ||
              frame.requestId < 0
            )
              throw failure();
            if (frame.type === "error") {
              terminal = true;
              fail(failure(frame.value?.code));
              continue;
            }
            if (frame.type === "ready") {
              if (readyReceived || frame.requestId !== 0 || pending)
                throw failure();
              const record = parseWorkflow(frame.value);
              taskId = record.taskId;
              assertWorkflowBinding(
                record,
                request.taskId ?? taskId,
                request.definition,
              );
              readyReceived = true;
              clearTimeout(timer);
              readyResolve();
            } else {
              const current = pending;
              if (!readyReceived || !current || current.id !== frame.requestId)
                throw failure();
              if (current.operation === "close") {
                if (
                  frame.type !== "closed" ||
                  !frame.value ||
                  Object.keys(frame.value).join() !== "released" ||
                  typeof frame.value.released !== "boolean"
                )
                  throw failure();
                terminal = true;
              } else {
                if (frame.type !== "result") throw failure();
                assertWorkflowBinding(
                  parseWorkflow(frame.value),
                  taskId,
                  request.definition,
                );
              }
              clearTimeout(timer);
              pending = undefined;
              current.resolve(frame.value);
              current.drained();
            }
          } catch {
            fail(failure("BLK-WORKFLOW-CHANNEL"));
          }
        }
      });
      child.on("error", () => fail(failure("BLK-WORKFLOW-CHANNEL")));
      child.on("close", (code) => {
        ended = true;
        exitCode = code;
        clearTimeout(timer);
        if (!terminal || buffer.trim() || code !== 0)
          fault ??= failure("BLK-WORKFLOW-CHANNEL");
        readyReject(fault ?? failure());
        pending?.reject(fault ?? failure());
        pending?.drained();
        pending = undefined;
        signal.removeEventListener("abort", abort);
        exitResolve();
      });
      const call = (
        operation: string,
        fields: Record<string, unknown> = {},
      ) => {
        const action = fields.action as { kind?: string } | undefined;
        // Cancellation stops new work, but an already dispatched effect must retain
        // its completion/uncertainty receipt. Closing the ledger is not effect settlement.
        const settlement =
          operation === "close" ||
          (operation === "commit" &&
            ["complete", "uncertain", "pause"].includes(action?.kind ?? ""));
        if (signal.aborted && !settlement)
          return Promise.reject(failure("BLK-WORKFLOW-CANCELLED"));
        if (
          fault ||
          ended ||
          terminal ||
          pending ||
          (closing && operation !== "close") ||
          ++serial > 1024
        )
          return Promise.reject(fault ?? failure());
        let drain!: () => void;
        drained = new Promise<void>((resolve) => {
          drain = resolve;
        });
        return new Promise<unknown>((resolve, reject) => {
          pending = {
            id: serial,
            operation,
            settlement,
            drained: drain,
            resolve,
            reject,
          };
          deadline();
          send({ operation, requestId: serial, ...fields });
        });
      };
      const waitExit = async () => {
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            exit,
            new Promise<void>((_, reject) => {
              killTimer = setTimeout(() => {
                child.kill();
                child.stdin.destroy();
                child.stdout.destroy();
                child.stderr.destroy();
                child.unref();
                reject(failure("BLK-WORKFLOW-CHANNEL"));
              }, 2500);
            }),
          ]);
        } finally {
          clearTimeout(killTimer);
        }
      };
      let closing: Promise<void> | undefined;
      const close = () =>
        (closing ??= (async () => {
          try {
            // A cancelled caller can return before its private acknowledgement.
            // Drain and validate that frame before sending the next serial request.
            await drained;
            if (!ended && !terminal && !fault) await call("close");
          } finally {
            try {
              await waitExit();
            } finally {
              signal.removeEventListener("abort", abort);
            }
          }
          if (fault || exitCode !== 0) throw fault ?? failure();
        })());
      const abort = () => {
        if (!readyReceived) {
          fail(failure("BLK-WORKFLOW-CANCELLED"));
        } else if (pending && !pending.settlement) {
          pending.reject(failure("BLK-WORKFLOW-CANCELLED"));
          // Retain the pending slot to verify a late frame. If the coordinator
          // fails to answer, terminate it without clearing the durable intent/owner.
          deadline(1000);
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      deadline();
      child.stdin.write(initial);
      if (signal.aborted) abort();
      try {
        await ready;
        signal.throwIfAborted();
        return {
          taskId,
          close,
          store: {
            read: async (id) => {
              if (id !== taskId) throw failure("BLK-WORKFLOW-BINDING");
              return (await call("read")) as WorkflowRecord;
            },
            commit: async (id, action) => {
              if (id !== taskId) throw failure("BLK-WORKFLOW-BINDING");
              return (await call("commit", { action })) as WorkflowRecord;
            },
          },
        };
      } catch (error) {
        await close();
        throw error;
      }
    },
  };
}
