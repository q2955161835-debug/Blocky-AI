import { invoke } from "@tauri-apps/api/core";
import {
  assertWorkflowBinding,
  parseWorkflow,
  type WorkflowPorts,
  type WorkflowSummary,
} from "@blocky/runtime-core";

const error = (value?: unknown) =>
  Error(
    String(value).match(/\bBLK-WORKFLOW-[A-Z-]+\b/)?.[0] ??
      "BLK-WORKFLOW-CHANNEL",
  );
const call = async <T>(command: string, request: unknown): Promise<T> => {
  try {
    return await invoke<T>(command, { request });
  } catch (e) {
    throw error(e);
  }
};
export const workflowNative = {
  list: async (projectId: string) => {
    const tasks = await call<WorkflowSummary[]>("workflow_query", {
      schemaVersion: "blocky.project-io/v1alpha1",
      operation: "workflow-list",
      projectId,
    });
    if (
      !Array.isArray(tasks) ||
      tasks.length > 128 ||
      tasks.some((task) => task.projectId !== projectId)
    )
      throw error("BLK-WORKFLOW-BINDING");
    return tasks;
  },
  decide: async (
    task: WorkflowSummary,
    decision: "approve" | "reject",
    approval?: string,
  ) => {
    const result = await call<{
      applied: boolean;
      requestDigest: string;
      task: WorkflowSummary;
      after?: WorkflowSummary;
    }>("workflow_decide", {
      schemaVersion: "blocky.project-io/v1alpha1",
      operation: "workflow-decide",
      projectId: task.projectId,
      taskId: task.taskId,
      revision: task.revision,
      stepId: task.stepId,
      decision,
      ...(approval ? { approval } : {}),
    });
    if (
      result.task.projectId !== task.projectId ||
      result.task.taskId !== task.taskId ||
      result.task.revision !== task.revision + (approval ? 1 : 0) ||
      result.applied !== !!approval ||
      !/^[a-f0-9]{64}$/.test(result.requestDigest) ||
      (approval && result.requestDigest !== approval)
    )
      throw error("BLK-WORKFLOW-BINDING");
    return result;
  },
};

/** Main-window ledger port. A closed ledger never proves external effects settled. */
export function studioWorkflowPorts(): WorkflowPorts {
  return {
    open: async (request, signal) => {
      signal.throwIfAborted();
      let token: string | undefined,
        taskId = "",
        pending: Promise<unknown> | undefined;
      let cancelling: Promise<unknown> | undefined,
        cancelError: unknown,
        closing: Promise<void> | undefined;
      const native = (operation: string, action?: unknown) =>
        call<unknown>("workflow_request", {
          sessionId: token,
          projectId: request.definition.projectId,
          operation,
          ...(action ? { action } : {}),
        });
      const cancel = () => {
        if (token)
          cancelling ??= native("cancel").catch((e) => {
            cancelError = e;
          });
      };
      signal.addEventListener("abort", cancel, { once: true });
      const close = () =>
        (closing ??= (async () => {
          try {
            await pending?.catch(() => {});
            await cancelling;
            if (token) {
              const result = (await native("close")) as { released: boolean };
              if (
                !result ||
                Object.keys(result).join() !== "released" ||
                typeof result.released !== "boolean"
              )
                throw error();
            }
            if (cancelError) throw cancelError;
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        })());
      try {
        const opened = await call<{ sessionId: string; record: unknown }>(
          "workflow_open",
          { schemaVersion: "blocky.workflow-session/v1", ...request },
        );
        token = opened.sessionId;
        if (typeof token !== "string" || !/^session-[a-f0-9-]{36}$/.test(token))
          throw error();
        const record = parseWorkflow(opened.record);
        taskId = record.taskId;
        assertWorkflowBinding(
          record,
          request.taskId ?? taskId,
          request.definition,
        );
        if (signal.aborted) {
          cancel();
          await close();
          signal.throwIfAborted();
        }
        const send = async (operation: string, action?: { kind: string }) => {
          const settlement =
            operation === "commit" &&
            ["complete", "uncertain", "pause"].includes(action?.kind ?? "");
          if (signal.aborted && !settlement)
            throw error("BLK-WORKFLOW-CANCELLED");
          if (closing || pending) throw error("BLK-WORKFLOW-CHANNEL");
          pending = native(operation, action);
          try {
            const saved = parseWorkflow(await pending);
            assertWorkflowBinding(saved, taskId, request.definition);
            return saved;
          } finally {
            pending = undefined;
          }
        };
        return {
          taskId,
          close,
          store: {
            read: async (id) => {
              if (id !== taskId) throw error("BLK-WORKFLOW-BINDING");
              return send("read");
            },
            commit: async (id, action) => {
              if (id !== taskId) throw error("BLK-WORKFLOW-BINDING");
              return send("commit", action);
            },
          },
        };
      } catch (e) {
        await close();
        throw e;
      }
    },
  };
}
