import { z } from "zod";
export { BrowserRpaAdapter, type BrowserRpaPorts } from "./browser";

const id = z.string().max(200).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const locator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("browser"), role: z.string().min(1).max(80), name: z.string().max(200).optional() }).strict(),
  z.object({ kind: z.literal("uia"), automationId: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200).optional(), controlType: z.string().min(1).max(80).optional() }).strict(),
  z.object({ kind: z.literal("coordinate"), x: z.number().int().nonnegative().max(32767), y: z.number().int().nonnegative().max(32767), riskAccepted: z.literal(true) }).strict(),
]);
const action = z.enum(["find", "read", "click", "fill", "wait", "screenshot"]);
export const rpaPlanSchema = z.object({
  schemaVersion: z.literal("blocky.rpa/v1"),
  planId: id,
  target: z.object({ kind: z.enum(["browser", "windows"]), identity: z.string().min(1).max(300) }).strict(),
  steps: z.array(z.object({
    stepId: id,
    action,
    locator,
    value: z.object({ kind: z.enum(["secret-ref", "manual-input"]), ref: id.optional() }).strict().optional(),
    timeoutMs: z.number().int().min(100).max(30000).default(5000),
    effectKey: id.optional(),
  }).strict()).min(1).max(100),
}).strict().superRefine((plan, ctx) => {
  const ids = new Set<string>();
  const keys = new Set<string>();
  plan.steps.forEach((step, index) => {
    if (ids.has(step.stepId)) ctx.addIssue({ code: "custom", message: "BLK-RPA-PLAN-001", path: ["steps", index, "stepId"] });
    ids.add(step.stepId);
    if (step.locator.kind === "browser" && plan.target.kind !== "browser" || step.locator.kind === "uia" && plan.target.kind !== "windows")
      ctx.addIssue({ code: "custom", message: "BLK-RPA-LOCATOR-002", path: ["steps", index, "locator"] });
    if (step.locator.kind === "uia" && !step.locator.automationId && !step.locator.name && !step.locator.controlType)
      ctx.addIssue({ code: "custom", message: "BLK-RPA-LOCATOR-001", path: ["steps", index, "locator"] });
    if (step.action === "fill" && !step.value || step.action !== "fill" && step.value)
      ctx.addIssue({ code: "custom", message: "BLK-RPA-INPUT-001", path: ["steps", index, "value"] });
    if (step.value && (step.value.kind === "secret-ref" && !step.value.ref || step.value.kind === "manual-input" && step.value.ref))
      ctx.addIssue({ code: "custom", message: "BLK-RPA-INPUT-001", path: ["steps", index, "value"] });
    if (["click", "fill"].includes(step.action) && !step.effectKey)
      ctx.addIssue({ code: "custom", message: "BLK-RPA-EFFECT-001", path: ["steps", index, "effectKey"] });
    if (step.effectKey) {
      if (keys.has(step.effectKey)) ctx.addIssue({ code: "custom", message: "BLK-RPA-EFFECT-002", path: ["steps", index, "effectKey"] });
      keys.add(step.effectKey);
    }
  });
});
export type RpaPlan = z.output<typeof rpaPlanSchema>;
export type RpaStep = RpaPlan["steps"][number];
export type RpaAction = z.output<typeof action>;

export const rpaRecoverySchema = z.object({
  schemaVersion: z.literal("blocky.rpa-recovery/v1"),
  checkpointId: z.string().max(80).regex(/^checkpoint-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  revision: z.number().int().min(1).max(2048),
  checks: z.array(z.object({ stepId: id, locator, expectedText: z.string().max(1024).optional() }).strict()).max(100),
}).strict().superRefine((request, ctx) => {
  const ids = new Set<string>();
  request.checks.forEach((check, index) => {
    if (ids.has(check.stepId) || check.locator.kind !== "uia" || !check.locator.automationId && !check.locator.name && !check.locator.controlType)
      ctx.addIssue({ code: "custom", message: "BLK-RPA-RECOVERY-003", path: ["checks", index] });
    ids.add(check.stepId);
    if (check.expectedText !== undefined && (new TextEncoder().encode(check.expectedText).byteLength > 1024 || check.expectedText.includes("\0")))
      ctx.addIssue({ code: "custom", message: "BLK-RPA-RECOVERY-003", path: ["checks", index, "expectedText"] });
  });
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 32768) ctx.addIssue({ code: "custom", message: "BLK-RPA-LIMIT-001" });
});
export type RpaRecovery = z.output<typeof rpaRecoverySchema>;

export const rpaGrantSchema = z.object({
  schemaVersion: z.literal("blocky.rpa-grant/v1"),
  sessionId: id,
  targetIdentity: z.string().min(1).max(300),
  actions: z.array(action).min(1),
  expiresAt: z.number().int().positive(),
  coordinateFallback: z.boolean().default(false),
}).strict();
export type RpaGrant = z.output<typeof rpaGrantSchema>;
export type RpaReceipt = { stepId: string; effectKey: string; targetIdentity: string; status: "completed" | "uncertain"; verified: boolean };
export type RpaEvent = { type: "step.started" | "step.completed" | "step.skipped" | "run.paused" | "run.resumed" | "run.stop-requested" | "run.stopped" | "run.completed" | "run.failed"; stepId?: string; action?: RpaAction; locatorKind?: RpaStep["locator"]["kind"]; effectKey?: string; summary: string };

/** Host-owned adapter. It must bind every operation to the same inspected app/window or tab.
 * perform must settle after an abort; the runner waits for settlement before reporting stopped.
 */
export interface RpaAdapter {
  readonly targetIdentity: string;
  verifyGrant(grant: RpaGrant, plan: RpaPlan, signal: AbortSignal): Promise<boolean>;
  verifyTarget(signal: AbortSignal): Promise<boolean>;
  verifyReceipt(receipt: RpaReceipt, step: RpaStep, signal: AbortSignal): Promise<boolean>;
  perform(step: RpaStep, signal: AbortSignal): Promise<void>;
}

/** Attended execution. Receipt verification is mandatory before resuming an effect. */
export class AttendedRpaRun {
  private state: "idle" | "running" | "paused" | "stopping" | "stopped" = "idle";
  private controller = new AbortController();
  private onEvent?: (event: RpaEvent) => void;
  private receiptLog: RpaReceipt[] = [];
  get status() { return this.state; }
  get checkpointReceipts(): RpaReceipt[] { return structuredClone(this.receiptLog); }
  pause() { if (this.state === "running") { this.state = "paused"; this.onEvent?.({ type: "run.paused", summary: "等待人工继续" }); } }
  resume() { if (this.state === "paused") { this.state = "running"; this.onEvent?.({ type: "run.resumed", summary: "人工已继续" }); } }
  stop() {
    if (this.state !== "running" && this.state !== "paused") return;
    this.state = "stopping";
    this.controller.abort();
    this.onEvent?.({ type: "run.stop-requested", summary: "正在停止当前步骤" });
  }
  async run(planInput: unknown, grantInput: unknown, adapter: RpaAdapter, options: { receipts?: RpaReceipt[]; now?: () => number; onEvent?: (event: RpaEvent) => void } = {}): Promise<RpaReceipt[]> {
    if (this.state !== "idle") throw Error("BLK-RPA-STATE-001");
    const plan = rpaPlanSchema.parse(planInput);
    const grant = rpaGrantSchema.parse(grantInput);
    const now = options.now ?? Date.now;
    const signal = this.controller.signal;
    if (grant.targetIdentity !== plan.target.identity || adapter.targetIdentity !== plan.target.identity || grant.expiresAt <= now())
      throw Error("BLK-RPA-PERM-001");
    if (plan.steps.some((step) => !grant.actions.includes(step.action) || step.locator.kind === "coordinate" && !grant.coordinateFallback))
      throw Error("BLK-RPA-PERM-001");
    if (!await adapter.verifyGrant(grant, plan, signal)) throw Error("BLK-RPA-PERM-001");
    const receipts = structuredClone(options.receipts ?? []);
    const seen = new Set<string>();
    for (const receipt of receipts) {
      const step = plan.steps.find((item) => item.stepId === receipt.stepId);
      if (!step || !step.effectKey || step.effectKey !== receipt.effectKey || receipt.targetIdentity !== plan.target.identity ||
          !["completed", "uncertain"].includes(receipt.status) || typeof receipt.verified !== "boolean" || seen.has(receipt.stepId))
        throw Error("BLK-RPA-RECEIPT-001");
      seen.add(receipt.stepId);
    }
    this.receiptLog = receipts;
    this.onEvent = options.onEvent;
    this.state = "running";
    let completed = false;
    try {
      for (const step of plan.steps) {
        while (this.status === "paused") await new Promise((resolve) => setTimeout(resolve, 20));
        signal.throwIfAborted();
        if (grant.expiresAt <= now() || !await adapter.verifyGrant(grant, plan, signal)) throw Error("BLK-RPA-PERM-001");
        if (!await adapter.verifyTarget(signal)) throw Error("BLK-RPA-TARGET-001");
        const prior = receipts.find((receipt) => receipt.stepId === step.stepId);
        if (prior) {
          if (!await adapter.verifyReceipt(prior, step, signal)) throw Error("BLK-RPA-RECEIPT-002");
          prior.status = "completed";
          prior.verified = true;
          this.onEvent?.({ type: "step.skipped", stepId: step.stepId, action: step.action, locatorKind: step.locator.kind, effectKey: prior.effectKey, summary: "已验证完成，跳过副作用" });
          continue;
        }
        this.onEvent?.({ type: "step.started", stepId: step.stepId, action: step.action, locatorKind: step.locator.kind, summary: "开始步骤" });
        const current: RpaReceipt | undefined = step.effectKey ? { stepId: step.stepId, effectKey: step.effectKey, targetIdentity: plan.target.identity, status: "uncertain", verified: false } : undefined;
        if (current) receipts.push(current);
        await boundedPerform(adapter, step, signal);
        signal.throwIfAborted();
        if (current) current.status = "completed";
        this.onEvent?.({ type: "step.completed", stepId: step.stepId, action: step.action, locatorKind: step.locator.kind, effectKey: step.effectKey, summary: "步骤完成" });
      }
      completed = true;
      return receipts;
    } finally {
      this.state = "stopped";
      this.onEvent?.(completed
        ? { type: "run.completed", summary: "运行已完成" }
        : signal.aborted
          ? { type: "run.stopped", summary: "运行已停止" }
          : { type: "run.failed", summary: "运行失败" });
    }
  }
}

async function boundedPerform(adapter: RpaAdapter, step: RpaStep, signal: AbortSignal): Promise<void> {
  const deadline = AbortSignal.timeout(step.timeoutMs);
  const operationSignal = AbortSignal.any([signal, deadline]);
  try {
    // An operation that has reached the OS/browser must settle before run()
    // reports stopped. Returning early could leave a click in flight.
    await adapter.perform(step, operationSignal);
    operationSignal.throwIfAborted();
  } catch (error) {
    if (deadline.aborted && !signal.aborted) throw Error("BLK-RPA-TIMEOUT-001");
    throw error;
  }
}

export type RecordedAction = { action: RpaAction; locator: RpaStep["locator"]; sensitive?: boolean; value?: string };
/** Recording produces a proposal; it never stores typed content, even for ordinary fields. */
export function recordingToDraft(actions: RecordedAction[]): { steps: RpaStep[]; requiresReview: true } {
  if (actions.length > 100) throw Error("BLK-RPA-RECORD-001");
  return { requiresReview: true, steps: actions.map((item, index) => ({
    stepId: `recorded-${index + 1}`, action: item.action, locator: item.locator,
    timeoutMs: 5000,
    ...(item.action === "fill" ? { value: { kind: "manual-input" as const } } : {}),
    ...(["click", "fill"].includes(item.action) ? { effectKey: `effect-${index + 1}` } : {}),
  })) };
}
