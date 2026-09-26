import {
  workflowCall as call,
  workflowError as error,
  waitWorkflow,
} from "./workflow-channel";
import {
  assertWorkflowBinding,
  parseWorkflow,
  parseWorkflowDecisionResult,
  parseWorkflowReconciliationResult,
  workflowSummarySchema,
  workflowReconciliationSchema,
  workflowJson,
  type WorkflowPorts,
  type WorkflowSummary,
} from "@blocky/runtime-core";
import type { Json } from "@blocky/language-schema";
export type WorkflowReconciliation =
  | { outcome: "not-executed" }
  | { outcome: "completed"; state: Json };

export const workflowNative = {
  list: async (projectId: string) => {
    const value = await call<unknown>("workflow_query", {
      schemaVersion: "blocky.project-io/v1alpha1",
      operation: "workflow-list",
      projectId,
    });
    const parsed = workflowSummarySchema.array().max(128).safeParse(value);
    if (
      !parsed.success ||
      parsed.data.some((task) => task.projectId !== projectId)
    )
      throw error("BLK-WORKFLOW-BINDING");
    return parsed.data;
  },
  decide: async (
    task: WorkflowSummary,
    decision: "approve" | "reject",
    approval?: string,
  ) => {
    const result = await call<unknown>("workflow_decide", {
      schemaVersion: "blocky.project-io/v1alpha1",
      operation: "workflow-decide",
      projectId: task.projectId,
      taskId: task.taskId,
      revision: task.revision,
      stepId: task.stepId,
      decision,
      ...(approval ? { approval } : {}),
    });
    return parseWorkflowDecisionResult(result, { ...task, approval });
  },
  reconcile: async (
    task: WorkflowSummary,
    choice: WorkflowReconciliation,
    approval?: string,
  ) => {
    if (!task.active) throw error("BLK-WORKFLOW-BINDING");
    const parsed = workflowReconciliationSchema.safeParse({
      projectId: task.projectId,
      taskId: task.taskId,
      revision: task.revision,
      stepId: task.active.stepId,
      direction: task.active.direction,
      ...choice,
      ...(approval ? { approval } : {}),
    });
    if (!parsed.success) throw error("BLK-WORKFLOW-INVALID");
    const request = parsed.data;
    if (request.outcome === "completed")
      request.state = workflowJson(request.state);
    const result = await call<unknown>("workflow_reconcile", {
      schemaVersion: "blocky.project-io/v1alpha1",
      operation: "workflow-reconcile",
      ...request,
    });
    return parseWorkflowReconciliationResult(result, request);
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
        channelError: Error | undefined,
        closing: Promise<void> | undefined;
      const validToken = (value: unknown): value is string =>
        typeof value === "string" && /^session-[a-f0-9-]{36}$/.test(value);
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
            if (channelError) throw channelError;
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        })());
      try {
        const opened = await call<{ sessionId: string; record: unknown }>(
          "workflow_open",
          { schemaVersion: "blocky.workflow-session/v1", ...request },
          {
            signal,
            onLate: async (opened) => {
              if (!validToken(opened?.sessionId)) return;
              const late = (operation: string) =>
                call("workflow_request", {
                  sessionId: opened.sessionId,
                  projectId: request.definition.projectId,
                  operation,
                });
              try {
                await late("cancel");
              } finally {
                await late("close");
              }
            },
          },
        );
        if (!validToken(opened?.sessionId)) throw error();
        token = opened.sessionId;
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
          if (channelError) throw channelError;
          if (closing || pending) throw error("BLK-WORKFLOW-CHANNEL");
          const work = native(operation, action).then((reply) => {
            const saved = parseWorkflow(reply);
            assertWorkflowBinding(saved, taskId, request.definition);
            return saved;
          });
          const drained = work.then(
            (saved) => {
              pending = undefined;
              return saved;
            },
            (failure) => {
              pending = undefined;
              channelError ??= error(failure);
              cancel();
              throw channelError;
            },
          );
          pending = drained;
          // Abort releases the caller immediately, but keeps the native request
          // in the serial slot until its receipt or deadline has been observed.
          return settlement ? drained : waitWorkflow(drained, { signal });
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
