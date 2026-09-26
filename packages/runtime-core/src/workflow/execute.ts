import { canonicalJson, type Json } from "@blocky/language-schema";
import {
  assertWorkflowBinding,
  parseWorkflow,
  requireWorkflow,
  type WorkflowDefinition,
  type WorkflowRecord,
  type WorkflowStep,
} from "./protocol";
import { transitionWorkflow, type WorkflowTransition } from "./transitions";

export interface WorkflowStore {
  read(taskId: string): Promise<WorkflowRecord>;
  /** Apply one validated transition under a durable revision CAS. Never accept a replacement snapshot.
   * The Host also enforces caller scope and settles the previous owner before a manual resolution.
   */
  commit(
    taskId: string,
    transition: WorkflowTransition,
  ): Promise<WorkflowRecord>;
}
type UnversionedTransition = WorkflowTransition extends infer T
  ? T extends { revision: number }
    ? Omit<T, "revision">
    : never
  : never;
export interface WorkflowDriver {
  /** Must settle owned child work before resolving/rejecting, including cancellation. */
  execute(
    step: Extract<WorkflowStep, { kind: "action" }>,
    context: { effectKey: string; state: Json; signal: AbortSignal },
  ): Promise<Json>;
  compensate(
    step: Extract<WorkflowStep, { kind: "action" }>,
    context: {
      effectKey: string;
      state: Json;
      before: Json;
      after: Json;
      signal: AbortSignal;
    },
  ): Promise<Json>;
}
/** Orchestrates existing Runtime child stacks; never replays or simulates a lost effect. */
export async function advanceWorkflow(
  store: WorkflowStore,
  taskId: string,
  definition: WorkflowDefinition,
  driver: WorkflowDriver,
  signal: AbortSignal,
  onCheckpoint?: (record: WorkflowRecord) => void,
): Promise<WorkflowRecord> {
  let record = parseWorkflow(await store.read(taskId));
  assertWorkflowBinding(record, taskId, definition);
  const persist = async (action: UnversionedTransition) => {
    const transition = {
      ...action,
      revision: record.revision,
    } as WorkflowTransition;
    const next = transitionWorkflow(record, transition);
    const saved = parseWorkflow(
      await store.commit(taskId, structuredClone(transition)),
    );
    requireWorkflow(
      canonicalJson(saved as unknown as Json) ===
        canonicalJson(next as unknown as Json),
      "BLK-WORKFLOW-CONFLICT",
    );
    record = saved;
    onCheckpoint?.(structuredClone(record));
  };
  while (true) {
    if (["executing", "undoing", "uncertain"].includes(record.status))
      throw Error("BLK-WORKFLOW-UNCERTAIN");
    if (
      ["awaiting-approval", "paused", "completed", "compensated"].includes(
        record.status,
      )
    )
      return record;
    if (signal.aborted) {
      await persist({ kind: "pause" });
      return record;
    }
    const step = record.definition.steps[record.cursor];
    if (!step) {
      await persist({ kind: "finish" });
      return record;
    }
    if (record.phase === "forward" && step.kind === "approval") {
      await persist({ kind: "await-approval" });
      return record;
    }
    if (record.phase === "forward" && step.kind === "checkpoint") {
      await persist({ kind: "checkpoint" });
      continue;
    }
    if (
      record.phase === "rollback" &&
      (step.kind !== "action" || !step.compensate)
    ) {
      await persist({ kind: "skip" });
      continue;
    }
    requireWorkflow(step.kind === "action");
    await persist({ kind: "begin" });
    // Cancellation after intent is durable but before dispatch leaves a known no-effect boundary.
    if (signal.aborted) {
      // Do not use a manual resolution to clear an intent: retain it conservatively for the Host.
      await persist({ kind: "uncertain", code: "BLK-WORKFLOW-CANCELLED" });
      return record;
    }
    let state: Json;
    try {
      const context = {
        effectKey: record.active!.effectKey,
        state: structuredClone(record.state),
        signal,
      };
      const receipt = record.receipts[record.cursor];
      state =
        record.phase === "forward"
          ? await driver.execute(step, context)
          : await driver.compensate(step, {
              ...context,
              before: structuredClone(receipt.before!),
              after: structuredClone(receipt.after!),
            });
    } catch {
      // Exception messages are untrusted data even when shaped like stable error codes.
      const code = signal.aborted
        ? "BLK-WORKFLOW-CANCELLED"
        : "BLK-WORKFLOW-EFFECT";
      await persist({ kind: "uncertain", code });
      return record;
    }
    // Even if cancellation arrives after success, save completion before observing cancellation.
    // If this write fails, the existing intent remains uncertain and cannot be replayed.
    await persist({ kind: "complete", state });
  }
}
