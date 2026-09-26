import type { Json } from "@blocky/language-schema";
import {
  effectKey,
  parseWorkflow,
  requireWorkflow,
  workflowJson,
  workflowKeys,
  type WorkflowRecord,
} from "./protocol";

export type WorkflowTransition = { revision: number } & (
  | {
      kind:
        | "begin"
        | "checkpoint"
        | "await-approval"
        | "finish"
        | "pause"
        | "resume"
        | "rollback"
        | "skip";
    }
  | { kind: "complete"; state: Json }
  | { kind: "uncertain"; code: string }
  | { kind: "decide"; stepId: string; decision: "approve" | "reject" }
  | { kind: "resolve"; outcome: "completed"; state: Json }
  | { kind: "resolve"; outcome: "not-executed" }
);

/** Pure state transition; Host must apply it under the same file lock as revision CAS. */
export function transitionWorkflow(
  input: WorkflowRecord,
  action: WorkflowTransition,
): WorkflowRecord {
  const record = parseWorkflow(input);
  requireWorkflow(action.revision === record.revision, "BLK-WORKFLOW-CONFLICT");
  const fields =
    action.kind === "complete"
      ? ["state"]
      : action.kind === "uncertain"
        ? ["code"]
        : action.kind === "decide"
          ? ["stepId", "decision"]
          : action.kind === "resolve"
            ? ["outcome", ...(action.outcome === "completed" ? ["state"] : [])]
            : [];
  workflowKeys(action, ["kind", "revision", ...fields]);
  const step = record.definition.steps[record.cursor],
    receipt = record.receipts[record.cursor];
  const live = () =>
    requireWorkflow(
      record.status === (record.phase === "forward" ? "ready" : "compensating"),
      "BLK-WORKFLOW-STATE",
    );
  const clearActive = () => {
    delete record.active;
    delete record.code;
  };
  const complete = (state: Json) => {
    requireWorkflow(
      step?.kind === "action" && record.active,
      "BLK-WORKFLOW-STATE",
    );
    const nextState = workflowJson(state);
    if (record.phase === "forward") {
      record.receipts[record.cursor] = {
        status: "completed",
        before: record.state,
        after: nextState,
      };
      record.cursor++;
      record.forwardCursor++;
      record.status = "ready";
    } else {
      receipt.status = "compensated";
      record.cursor--;
      record.status = "compensating";
    }
    record.state = nextState;
    clearActive();
  };
  switch (action.kind) {
    case "begin":
      live();
      requireWorkflow(
        step?.kind === "action" &&
          (record.phase === "forward" || step.compensate),
        "BLK-WORKFLOW-STATE",
      );
      record.active = {
        stepId: step.stepId,
        direction: record.phase,
        effectKey: effectKey(record),
      };
      record.status = record.phase === "forward" ? "executing" : "undoing";
      break;
    case "complete":
      requireWorkflow(
        ["executing", "undoing"].includes(record.status),
        "BLK-WORKFLOW-STATE",
      );
      complete(action.state);
      break;
    case "uncertain":
      requireWorkflow(
        ["executing", "undoing"].includes(record.status),
        "BLK-WORKFLOW-STATE",
      );
      record.status = "uncertain";
      record.code = action.code;
      break;
    case "checkpoint":
      requireWorkflow(
        record.phase === "forward" &&
          record.status === "ready" &&
          step?.kind === "checkpoint",
        "BLK-WORKFLOW-STATE",
      );
      receipt.status = "completed";
      record.cursor++;
      record.forwardCursor++;
      break;
    case "await-approval":
      requireWorkflow(
        record.phase === "forward" &&
          record.status === "ready" &&
          step?.kind === "approval",
        "BLK-WORKFLOW-STATE",
      );
      record.status = "awaiting-approval";
      break;
    case "decide":
      requireWorkflow(
        record.status === "awaiting-approval" &&
          step?.kind === "approval" &&
          step.stepId === action.stepId &&
          ["approve", "reject"].includes(action.decision),
        "BLK-WORKFLOW-STATE",
      );
      if (action.decision === "approve") {
        receipt.status = "approved";
        record.cursor++;
        record.forwardCursor++;
        record.status = "ready";
      } else {
        receipt.status = "rejected";
        record.cursor--;
        record.phase = "rollback";
        record.status = "compensating";
      }
      break;
    case "skip":
      requireWorkflow(
        record.phase === "rollback" &&
          record.status === "compensating" &&
          step &&
          (step.kind !== "action" || !step.compensate),
        "BLK-WORKFLOW-STATE",
      );
      if (step.kind === "action") receipt.status = "skipped";
      record.cursor--;
      break;
    case "finish":
      live();
      requireWorkflow(
        record.phase === "forward"
          ? record.cursor === record.definition.steps.length
          : record.cursor === -1,
        "BLK-WORKFLOW-STATE",
      );
      record.status = record.phase === "forward" ? "completed" : "compensated";
      break;
    case "pause":
      live();
      record.status = "paused";
      break;
    case "resume":
      requireWorkflow(record.status === "paused", "BLK-WORKFLOW-STATE");
      record.status = record.phase === "forward" ? "ready" : "compensating";
      break;
    case "rollback":
      requireWorkflow(
        record.phase === "forward" &&
          ["ready", "paused", "awaiting-approval", "completed"].includes(
            record.status,
          ),
        "BLK-WORKFLOW-STATE",
      );
      if (record.status === "awaiting-approval") receipt.status = "rejected";
      record.cursor--;
      record.phase = "rollback";
      record.status = "compensating";
      break;
    case "resolve":
      requireWorkflow(
        ["executing", "undoing", "uncertain"].includes(record.status) &&
          record.active &&
          ["completed", "not-executed"].includes(action.outcome),
        "BLK-WORKFLOW-STATE",
      );
      record.resolutions.push({
        revision: record.revision,
        stepId: record.active.stepId,
        direction: record.active.direction,
        outcome: action.outcome,
      });
      if (action.outcome === "completed") complete(action.state);
      else {
        clearActive();
        record.status = record.phase === "forward" ? "ready" : "compensating";
      }
      break;
    default:
      throw Error("BLK-WORKFLOW-INVALID");
  }
  record.revision++;
  return parseWorkflow(record);
}
