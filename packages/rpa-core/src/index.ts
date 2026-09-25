import { z } from "zod";
export { BrowserRpaAdapter, type BrowserRpaPorts } from "./browser";

const id = z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
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

export const rpaGrantSchema = z.object({
  schemaVersion: z.literal("blocky.rpa-grant/v1"),
  sessionId: id,
  targetIdentity: z.string().min(1).max(300),
  actions: z.array(action).min(1),
  expiresAt: z.number().int().positive(),
  coordinateFallback: z.boolean().default(false),
}).strict();
export type RpaGrant = z.output<typeof rpaGrantSchema>;
export type RpaReceipt = { stepId: string; effectKey: string; targetIdentity: string; status: "completed"; verified: boolean };
export type RpaEvent = { type: "step.started" | "step.completed" | "step.skipped" | "run.paused" | "run.resumed" | "run.stopped"; stepId?: string; action?: RpaAction; locatorKind?: RpaStep["locator"]["kind"]; effectKey?: string; summary: string };

/** Host-owned adapter. It must bind every operation to the same inspected app/window or tab. */
export interface RpaAdapter {
  readonly targetIdentity: string;
  verifyTarget(signal: AbortSignal): Promise<boolean>;
  verifyReceipt(receipt: RpaReceipt, step: RpaStep, signal: AbortSignal): Promise<boolean>;
  perform(step: RpaStep, signal: AbortSignal): Promise<void>;
}

/** Attended execution. Receipt verification is mandatory before resuming an effect. */
export class AttendedRpaRun {
  private state: "idle" | "running" | "paused" | "stopped" = "idle";
  private controller = new AbortController();
  private onEvent?: (event: RpaEvent) => void;
  get status() { return this.state; }
  pause() { if (this.state === "running") { this.state = "paused"; this.onEvent?.({ type: "run.paused", summary: "等待人工继续" }); } }
  resume() { if (this.state === "paused") { this.state = "running"; this.onEvent?.({ type: "run.resumed", summary: "人工已继续" }); } }
  stop() { this.state = "stopped"; this.controller.abort(); this.onEvent?.({ type: "run.stopped", summary: "运行已停止" }); }
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
    const receipts = [...(options.receipts ?? [])];
    const seen = new Set<string>();
    for (const receipt of receipts) {
      const step = plan.steps.find((item) => item.stepId === receipt.stepId);
      if (!step || !step.effectKey || step.effectKey !== receipt.effectKey || receipt.targetIdentity !== plan.target.identity || seen.has(receipt.stepId))
        throw Error("BLK-RPA-RECEIPT-001");
      seen.add(receipt.stepId);
    }
    this.onEvent = options.onEvent;
    this.state = "running";
    try {
      for (const step of plan.steps) {
        while (this.status === "paused") await new Promise((resolve) => setTimeout(resolve, 20));
        signal.throwIfAborted();
        if (grant.expiresAt <= now() || !await adapter.verifyTarget(signal)) throw Error("BLK-RPA-TARGET-001");
        const prior = receipts.find((receipt) => receipt.stepId === step.stepId);
        if (prior) {
          if (!await adapter.verifyReceipt(prior, step, signal)) throw Error("BLK-RPA-RECEIPT-002");
          this.onEvent?.({ type: "step.skipped", stepId: step.stepId, action: step.action, locatorKind: step.locator.kind, effectKey: prior.effectKey, summary: "已验证完成，跳过副作用" });
          continue;
        }
        this.onEvent?.({ type: "step.started", stepId: step.stepId, action: step.action, locatorKind: step.locator.kind, summary: "开始步骤" });
        await adapter.perform(step, signal);
        signal.throwIfAborted();
        if (step.effectKey) receipts.push({ stepId: step.stepId, effectKey: step.effectKey, targetIdentity: plan.target.identity, status: "completed", verified: false });
        this.onEvent?.({ type: "step.completed", stepId: step.stepId, action: step.action, locatorKind: step.locator.kind, effectKey: step.effectKey, summary: "步骤完成" });
      }
      return receipts;
    } finally { this.state = "stopped"; }
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
