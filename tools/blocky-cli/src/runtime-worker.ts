// Private native-owned entry. The public CLI never invokes this with user supplied executable paths.
import { parse } from "./arguments";
import { dispatch } from "./commands";
import { closeNativeKnowledge } from "./native-store";
import { failure } from "./protocol";
import { workflowErrorCode } from "./workflow-errors";
import {
  parseWorkflow,
  assertWorkflowBinding,
  type WorkflowPorts,
  type WorkflowRecord,
  RemoteRuntime,
} from "@blocky/runtime-core";
const MAX = 20 * 1024 * 1024;
const abort = new AbortController();
let buffer = "",
  started = false,
  serial = 0;
let desktop: RemoteRuntime | undefined;
let inputClosed = false;
const pending = new Map<
  number,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const send = (frame: unknown) => {
  const line = JSON.stringify(frame) + "\n";
  if (Buffer.byteLength(line) > MAX) throw Error("BLK-WORKFLOW-LIMIT");
  process.stdout.write(line);
};
function call(operation: string, fields: Record<string, unknown> = {}) {
  if (inputClosed) return Promise.reject(Error("BLK-WORKFLOW-CHANNEL"));
  const id = ++serial;
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(Error("BLK-WORKFLOW-CHANNEL"));
        abort.abort();
      },
      operation === "approval"
        ? 310000
        : operation === "service"
          ? 180000
          : 10000,
    );
    pending.set(id, { resolve, reject, timer });
    try {
      send({ kind: "workflow", id, operation, ...fields });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
      abort.abort();
    }
  });
}
const workflow: WorkflowPorts = {
  open: async (request, signal) => {
    signal.throwIfAborted();
    const record = parseWorkflow(
      await call("open", {
        request: { schemaVersion: "blocky.workflow-session/v1", ...request },
      }),
    );
    assertWorkflowBinding(
      record,
      request.taskId ?? record.taskId,
      request.definition,
    );
    let closed = false;
    const checked = async (
      id: string,
      operation: string,
      fields: Record<string, unknown> = {},
    ) => {
      if (closed || id !== record.taskId) throw Error("BLK-WORKFLOW-BINDING");
      const next = parseWorkflow(await call(operation, fields));
      assertWorkflowBinding(next, record.taskId, request.definition);
      return next as WorkflowRecord;
    };
    return {
      taskId: record.taskId,
      store: {
        read: (id) => checked(id, "read"),
        commit: (id, action) => checked(id, "commit", { action }),
      },
      close: async () => {
        if (!closed) {
          closed = true;
          await call("close");
        }
      },
    };
  },
};
function finish() {
  inputClosed = true;
  process.stdin.destroy();
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error("BLK-WORKFLOW-CHANNEL"));
  }
  pending.clear();
}
async function startDesktop(request: unknown) {
  desktop = new RemoteRuntime(
    async (request, signal) => {
      const cancel = () => send({ kind: "cancel" });
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await call("service", { request });
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    workflow,
    160,
  );
  try {
    const value = await desktop.run(request, abort.signal, (value) =>
      send({ kind: "event", value }),
    );
    send({ kind: "desktop-done", value });
  } catch {
    process.exitCode = 3;
    send({ kind: "error", code: "BLK-RUN-STATE" });
  } finally {
    finish();
  }
}
async function start(argv: unknown) {
  if (
    !Array.isArray(argv) ||
    argv.length > 256 ||
    argv.some((v) => typeof v !== "string" || v.length > 16384)
  )
    throw Error("BLK-WORKFLOW-INVALID");
  const args = parse(argv);
  if (args.words[0] !== "run" || args.words[1] !== "start")
    throw Error("BLK-WORKFLOW-INVALID");
  try {
    const result = await dispatch(
      args,
      (value) => send({ kind: "output", value }),
      abort.signal,
      {
        workflow,
        approve: async (value, signal) => {
          signal.throwIfAborted();
          const cancel = () => send({ kind: "cancel" });
          signal.addEventListener("abort", cancel, { once: true });
          try {
            return (await call("approval", { value })) === true;
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        },
      },
    );
    await closeNativeKnowledge();
    send({ kind: "done", value: result });
  } catch (error) {
    const result = failure("run.start", error);
    await closeNativeKnowledge();
    send({
      kind: "done",
      value: { code: result.exitCode, result: result.result },
    });
  } finally {
    finish();
  }
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  try {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX) throw Error();
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const frame = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (
        frame.kind === "start" &&
        !started &&
        frame.schemaVersion === "blocky.runtime-session/v1" &&
        Object.keys(frame).sort().join() === "argv,kind,schemaVersion"
      ) {
        started = true;
        void start(frame.argv).catch(() => {
          process.exitCode = 3;
          process.stdin.destroy();
        });
      } else if (
        frame.kind === "start" &&
        !started &&
        frame.schemaVersion === "blocky.desktop-session/v1" &&
        Object.keys(frame).sort().join() === "kind,request,schemaVersion"
      ) {
        started = true;
        void startDesktop(frame.request);
      } else if (
        frame.kind === "control" &&
        desktop &&
        Object.keys(frame).sort().join() === "action,kind" &&
        ["pause", "resume", "step"].includes(frame.action)
      ) {
        desktop.control(frame.action);
      } else if (
        frame.kind === "cancel" &&
        Object.keys(frame).join() === "kind"
      )
        abort.abort();
      else if (
        frame.kind === "reply" &&
        Object.keys(frame).sort().join() === "id,kind,ok,value"
      ) {
        const p = pending.get(frame.id);
        if (!p || typeof frame.ok !== "boolean") throw Error();
        pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.value);
        else
          p.reject(
            Error(
              desktop && frame.value?.code === "BLK-RUN-SERVICE"
                ? "BLK-RUN-SERVICE"
                : workflowErrorCode(frame.value?.code),
            ),
          );
      } else throw Error();
    }
  } catch {
    abort.abort();
    process.exitCode = 3;
    finish();
  }
});
process.stdin.on("end", () => {
  inputClosed = true;
  abort.abort();
  finish();
});
