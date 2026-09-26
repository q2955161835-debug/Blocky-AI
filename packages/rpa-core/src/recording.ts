import { z } from "zod";
import { canonicalJson } from "@blocky/language-schema";
import { recordingToDraft, rpaPlanSchema } from "./index";

const id = z.string().max(200).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const reason = z.enum(["stopped", "limit", "expired", "target-lost", "capture-failed"]);
const metadata = z.string().trim().min(1).max(200).refine(text =>
  !/[\u0000-\u001f\u007f]/.test(text) &&
  !/\bBearer\s+\S+|\b(?:sk|ghp|gho|github_pat)[_-][A-Za-z0-9_-]{12,}|(?:password|secret|token|api[-_ ]?key|密码|密钥)\s*[:=]\s*\S+/i.test(text),
);
export const rpaRecordedActionSchema = z.object({
  action: z.enum(["click", "fill"]),
  locator: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("browser"), role: z.enum(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "spinbutton", "switch", "menuitem", "tab"]), name: metadata }).strict(),
    z.object({ kind: z.literal("uia"), automationId: metadata.optional(), name: metadata.optional(), controlType: metadata.optional() }).strict().refine(value => !!value.automationId || !!value.name),
  ]),
  sensitive: z.boolean().optional(),
}).strict();
const optionsSchema = z.object({
  sessionId: id, projectId: id, target: rpaPlanSchema.shape.target,
}).strict();
export const rpaRecordingResultSchema = optionsSchema.extend({
  schemaVersion: z.literal("blocky.rpa-recording-result/v1"),
  requiresReview: z.literal(true),
  startedAt: z.number().int().nonnegative(), stoppedAt: z.number().int().nonnegative(),
  reason, omitted: z.number().int().min(0).max(10000),
  actions: z.array(rpaRecordedActionSchema).max(100),
  plan: rpaPlanSchema.optional(),
}).strict().superRefine((draft, ctx) => {
  const expected = draft.actions.length ? {
    schemaVersion: "blocky.rpa/v1", planId: draft.sessionId,
    target: draft.target, steps: recordingToDraft(draft.actions).steps,
  } : undefined;
  if (new TextEncoder().encode(JSON.stringify(draft)).length > 60000 || draft.stoppedAt < draft.startedAt || (!!draft.plan !== !!expected) || draft.plan && expected && canonicalJson(draft.plan) !== canonicalJson(expected) ||
      draft.actions.some(action => (action.locator.kind === "browser") !== (draft.target.kind === "browser")))
    ctx.addIssue({ code: "custom", message: "BLK-RPA-RECORD-001" });
});
export type RpaRecordingResult = z.output<typeof rpaRecordingResultSchema>;
export type RpaRecordedAction = z.output<typeof rpaRecordedActionSchema>;
export type RpaRecordingReason = z.output<typeof reason>;
export type RpaRecordingOptions = z.output<typeof optionsSchema>;

/** Metadata buffer only. A native recording approval and a bounded collector own its lifetime. */
export class RecordingBuffer {
  private readonly options: RpaRecordingOptions;
  private readonly startedAt: number;
  private readonly actions: RpaRecordedAction[] = [];
  private omitted = 0;
  private draft?: RpaRecordingResult;
  constructor(options: RpaRecordingOptions, private readonly clock = Date.now) {
    this.options = optionsSchema.parse(options);
    this.startedAt = clock();
    if (!Number.isSafeInteger(this.startedAt) || this.startedAt < 0) throw Error("BLK-RPA-RECORD-001");
  }
  status() {
    this.expire();
    return {
      sessionId: this.options.sessionId, state: this.draft ? "stopped" as const : "recording" as const,
      count: this.actions.length, omitted: this.omitted, startedAt: this.startedAt,
      expiresAt: this.startedAt + 600000, ...(this.draft ? { reason: this.draft.reason } : {}),
    };
  }
  append(input: unknown): boolean {
    this.expire();
    if (this.draft) return false;
    const parsed = rpaRecordedActionSchema.safeParse(input);
    if (!parsed.success || (parsed.data.locator.kind === "browser") !== (this.options.target.kind === "browser")) {
      this.omitted = Math.min(10000, this.omitted + 1);
      return false;
    }
    const action = parsed.data, previous = this.actions.at(-1);
    if (action.action === "fill" && previous?.action === "fill" && canonicalJson(previous.locator) === canonicalJson(action.locator)) {
      if (action.sensitive) previous.sensitive = true;
      return true;
    }
    // The result includes both metadata and a proposal. Reserve space for the envelope
    // so long multibyte UIA names cannot overflow the shared 64 KiB native pipe.
    const candidate = [...this.actions, action];
    if (new TextEncoder().encode(JSON.stringify({ actions: candidate, steps: recordingToDraft(candidate).steps })).length > 49152) {
      this.omitted = Math.min(10000, this.omitted + 1);
      this.seal("limit");
      return false;
    }
    this.actions.push(action);
    if (this.actions.length === 100) this.seal("limit");
    return true;
  }
  seal(stopReason: RpaRecordingReason): RpaRecordingResult {
    if (!this.draft) {
      const stoppedAt = Math.max(this.startedAt, this.clock());
      this.draft = rpaRecordingResultSchema.parse({
        ...this.options, schemaVersion: "blocky.rpa-recording-result/v1", requiresReview: true,
        startedAt: this.startedAt, stoppedAt, reason: stoppedAt >= this.startedAt + 600000 ? "expired" : stopReason,
        omitted: this.omitted, actions: this.actions,
        ...(this.actions.length ? { plan: {
          schemaVersion: "blocky.rpa/v1", planId: this.options.sessionId, target: this.options.target,
          steps: recordingToDraft(this.actions).steps,
        } } : {}),
      });
    }
    return structuredClone(this.draft);
  }
  private expire() {
    if (!this.draft && this.clock() >= this.startedAt + 600000) this.seal("expired");
  }
}
