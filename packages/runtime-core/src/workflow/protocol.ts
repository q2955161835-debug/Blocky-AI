import { canonicalJson, stableId, type Json } from "@blocky/language-schema";

export const WORKFLOW_INVALID = "BLK-WORKFLOW-INVALID";
export type WorkflowStep =
  | { stepId: string; kind: "action"; compensate: boolean }
  | { stepId: string; kind: "approval"; label: string }
  | { stepId: string; kind: "checkpoint" };
export type WorkflowDefinition = {
  projectId: string;
  moduleId: string;
  blockId: string;
  planDigest: string;
  runtimeVersion: 1;
  steps: WorkflowStep[];
};
export type WorkflowStatus =
  | "ready"
  | "executing"
  | "awaiting-approval"
  | "paused"
  | "compensating"
  | "undoing"
  | "uncertain"
  | "completed"
  | "compensated";
export type WorkflowDirection = "forward" | "rollback";
export type WorkflowActive = {
  stepId: string;
  direction: WorkflowDirection;
  effectKey: string;
};
export type WorkflowReceipt = {
  status:
    | "pending"
    | "completed"
    | "approved"
    | "rejected"
    | "compensated"
    | "skipped";
  before?: Json;
  after?: Json;
};
export type WorkflowRecord = {
  schemaVersion: "blocky.workflow/v1";
  taskId: string;
  definition: WorkflowDefinition;
  revision: number;
  cursor: number;
  forwardCursor: number;
  phase: WorkflowDirection;
  status: WorkflowStatus;
  state: Json;
  receipts: WorkflowReceipt[];
  active?: WorkflowActive;
  code?: string;
  resolutions: {
    revision: number;
    stepId: string;
    direction: WorkflowDirection;
    outcome: "completed" | "not-executed";
  }[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && stableId.test(value);
export function requireWorkflow(
  condition: unknown,
  code = WORKFLOW_INVALID,
): asserts condition {
  if (!condition) throw Error(code);
}
export function workflowKeys(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  requireWorkflow(object(value));
  requireWorkflow(
    required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every(
        (key) => required.includes(key) || optional.includes(key),
      ),
  );
}
/** No toJSON/accessor/prototype behavior, cycles, non-finite numbers or unbounded trees. */
export function workflowJson(value: unknown, limit = 131072): Json {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    requireWorkflow(++nodes <= 50000 && depth <= 32, "BLK-WORKFLOW-LIMIT");
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return;
    if (typeof item === "number") {
      requireWorkflow(Number.isFinite(item));
      return;
    }
    requireWorkflow(
      typeof item === "object" && item !== null && !seen.has(item),
    );
    seen.add(item);
    requireWorkflow(
      Array.isArray(item) ||
        Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null,
    );
    requireWorkflow(Object.getOwnPropertySymbols(item).length === 0);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(item),
    )) {
      if (Array.isArray(item) && key === "length") continue;
      requireWorkflow("value" in descriptor && descriptor.enumerable);
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item))
      requireWorkflow(
        Object.keys(item).length === item.length &&
          Object.keys(item).every((key, index) => key === String(index)),
      );
    seen.delete(item);
  };
  visit(value, 0);
  const text = JSON.stringify(value);
  requireWorkflow(
    new TextEncoder().encode(text).length <= limit,
    "BLK-WORKFLOW-LIMIT",
  );
  return JSON.parse(text) as Json;
}
export function parseWorkflowDefinition(value: unknown): WorkflowDefinition {
  const input = workflowJson(value, 32768);
  workflowKeys(input, [
    "projectId",
    "moduleId",
    "blockId",
    "planDigest",
    "runtimeVersion",
    "steps",
  ]);
  requireWorkflow(
    id(input.projectId) &&
      id(input.moduleId) &&
      id(input.blockId) &&
      input.runtimeVersion === 1,
  );
  requireWorkflow(
    typeof input.planDigest === "string" &&
      /^[a-f0-9]{64}$/.test(input.planDigest),
  );
  requireWorkflow(
    Array.isArray(input.steps) &&
      input.steps.length >= 1 &&
      input.steps.length <= 64,
    "BLK-WORKFLOW-LIMIT",
  );
  const ids = new Set<string>();
  for (const step of input.steps) {
    requireWorkflow(object(step));
    workflowKeys(step, [
      "stepId",
      "kind",
      ...(step.kind === "action"
        ? ["compensate"]
        : step.kind === "approval"
          ? ["label"]
          : []),
    ]);
    requireWorkflow(id(step.stepId) && !ids.has(step.stepId));
    ids.add(step.stepId);
    requireWorkflow(
      ["action", "approval", "checkpoint"].includes(String(step.kind)),
    );
    if (step.kind === "action")
      requireWorkflow(typeof step.compensate === "boolean");
    if (step.kind === "approval")
      requireWorkflow(
        typeof step.label === "string" &&
          step.label.length >= 1 &&
          new TextEncoder().encode(step.label).length <= 1000 &&
          !step.label.includes("\0"),
      );
  }
  return input as unknown as WorkflowDefinition;
}
export function effectKey(
  record: WorkflowRecord,
  index = record.cursor,
): string {
  return `${record.taskId}:${record.definition.steps[index].stepId}:${record.phase}`;
}
export function parseWorkflow(value: unknown): WorkflowRecord {
  const input = workflowJson(value, 1048576);
  workflowKeys(
    input,
    [
      "schemaVersion",
      "taskId",
      "definition",
      "revision",
      "cursor",
      "forwardCursor",
      "phase",
      "status",
      "state",
      "receipts",
      "resolutions",
    ],
    ["active", "code"],
  );
  requireWorkflow(
    input.schemaVersion === "blocky.workflow/v1" &&
      id(input.taskId) &&
      integer(input.revision, 1, 65535),
  );
  const plan = parseWorkflowDefinition(input.definition),
    count = plan.steps.length;
  requireWorkflow(
    integer(input.cursor, -1, count) &&
      ["forward", "rollback"].includes(String(input.phase)),
  );
  const cursor = input.cursor;
  requireWorkflow(integer(input.forwardCursor, 0, count));
  const forwardCursor = input.forwardCursor;
  requireWorkflow(
    input.phase === "forward"
      ? cursor === forwardCursor
      : cursor < forwardCursor,
  );
  requireWorkflow(
    [
      "ready",
      "executing",
      "awaiting-approval",
      "paused",
      "compensating",
      "undoing",
      "uncertain",
      "completed",
      "compensated",
    ].includes(String(input.status)),
  );
  workflowJson(input.state);
  requireWorkflow(
    Array.isArray(input.receipts) && input.receipts.length === count,
  );
  input.receipts.forEach((receipt, index) => {
    workflowKeys(receipt, ["status"], ["before", "after"]);
    const step = plan.steps[index];
    const states =
      step.kind === "action"
        ? ["pending", "completed", step.compensate ? "compensated" : "skipped"]
        : step.kind === "approval"
          ? ["pending", "approved", "rejected"]
          : ["pending", "completed"];
    requireWorkflow(states.includes(String(receipt.status)));
    const hasState = step.kind === "action" && receipt.status !== "pending";
    requireWorkflow(
      Object.hasOwn(receipt, "before") === hasState &&
        Object.hasOwn(receipt, "after") === hasState,
    );
    if (hasState) {
      workflowJson(receipt.before);
      workflowJson(receipt.after);
    }
    if (index < forwardCursor) {
      const expected =
        step.kind === "approval"
          ? "approved"
          : step.kind === "action" &&
              input.phase === "rollback" &&
              index > cursor
            ? step.compensate
              ? "compensated"
              : "skipped"
            : "completed";
      requireWorkflow(receipt.status === expected);
    } else {
      const rejected =
        input.phase === "rollback" &&
        index === forwardCursor &&
        step.kind === "approval" &&
        receipt.status === "rejected";
      requireWorkflow(receipt.status === "pending" || rejected);
    }
  });
  const current = plan.steps[input.cursor];
  if (input.phase === "forward")
    requireWorkflow(
      input.cursor >= 0 &&
        !["compensating", "undoing", "compensated"].includes(
          String(input.status),
        ),
    );
  else
    requireWorkflow(
      cursor < count &&
        !["ready", "executing", "awaiting-approval", "completed"].includes(
          String(input.status),
        ),
    );
  if (input.status === "completed") requireWorkflow(input.cursor === count);
  if (input.status === "compensated") requireWorkflow(input.cursor === -1);
  if (input.status === "awaiting-approval")
    requireWorkflow(current?.kind === "approval");
  const active = ["executing", "undoing", "uncertain"].includes(
    String(input.status),
  );
  requireWorkflow(Object.hasOwn(input, "active") === active);
  if (active) {
    workflowKeys(input.active, ["stepId", "direction", "effectKey"]);
    requireWorkflow(
      current?.kind === "action" &&
        input.active.stepId === current.stepId &&
        input.active.direction === input.phase,
    );
    requireWorkflow(
      input.active.effectKey ===
        `${input.taskId}:${current.stepId}:${input.phase}`,
    );
    if (input.phase === "rollback") requireWorkflow(current.compensate);
  }
  requireWorkflow(
    Object.hasOwn(input, "code") === (input.status === "uncertain"),
  );
  if (input.code !== undefined)
    requireWorkflow(
      input.code === "BLK-WORKFLOW-EFFECT" ||
        input.code === "BLK-WORKFLOW-CANCELLED",
    );
  requireWorkflow(
    Array.isArray(input.resolutions) && input.resolutions.length <= 128,
  );
  let last = 0;
  for (const resolution of input.resolutions) {
    workflowKeys(resolution, ["revision", "stepId", "direction", "outcome"]);
    requireWorkflow(integer(resolution.revision, last + 1, input.revision - 1));
    last = resolution.revision;
    requireWorkflow(
      plan.steps.some(
        (step) => step.kind === "action" && step.stepId === resolution.stepId,
      ) &&
        ["forward", "rollback"].includes(String(resolution.direction)) &&
        ["completed", "not-executed"].includes(String(resolution.outcome)),
    );
  }
  return input as unknown as WorkflowRecord;
}
export function createWorkflow(
  taskId: string,
  definition: WorkflowDefinition,
  state: Json,
): WorkflowRecord {
  return parseWorkflow({
    schemaVersion: "blocky.workflow/v1",
    taskId,
    definition,
    revision: 1,
    cursor: 0,
    forwardCursor: 0,
    phase: "forward",
    status: "ready",
    state,
    receipts: definition.steps.map(() => ({ status: "pending" })),
    resolutions: [],
  });
}
export function assertWorkflowBinding(
  record: WorkflowRecord,
  taskId: string,
  definition: WorkflowDefinition,
): void {
  requireWorkflow(
    record.taskId === taskId &&
      canonicalJson(record.definition as unknown as Json) ===
        canonicalJson(definition as unknown as Json),
    "BLK-WORKFLOW-BINDING",
  );
}
/** Safe display projection: persistent context and rollback frames never enter logs. */
export function workflowSummary(input: WorkflowRecord) {
  const record = parseWorkflow(input);
  return {
    schemaVersion: "blocky.workflow-summary/v1" as const,
    taskId: record.taskId,
    projectId: record.definition.projectId,
    moduleId: record.definition.moduleId,
    blockId: record.definition.blockId,
    planDigest: record.definition.planDigest,
    revision: record.revision,
    status: record.status,
    phase: record.phase,
    cursor: record.cursor,
    forwardCursor: record.forwardCursor,
    totalSteps: record.definition.steps.length,
    ...(record.definition.steps[record.cursor]
      ? { stepId: record.definition.steps[record.cursor].stepId }
      : {}),
    ...(record.active ? { active: record.active } : {}),
    ...(record.code ? { code: record.code } : {}),
    receipts: record.receipts.map((receipt, index) => ({
      stepId: record.definition.steps[index].stepId,
      status: receipt.status,
    })),
    resolutions: record.resolutions,
  };
}
