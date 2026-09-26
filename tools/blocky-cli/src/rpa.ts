import { recordingToDraft, rpaPlanSchema, type RecordedAction } from "@blocky/rpa-core";
import { z } from "zod";
import { allow, required, type Args } from "./arguments";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";
import { nativeUserOperation } from "./native-store";
import { runNativeRpa } from "./rpa-transport";

export const rpaHelp = [
  "rpa targets --json",
  "rpa checkpoints --json",
  "rpa checkpoint <checkpoint-id> [--plan <plan.json>] --json",
  "rpa run <plan.json> [--inputs <step-inputs.json>] [--control-stdin] --jsonl",
  "rpa validate <plan.json> --json",
  "rpa recording-import <recording.json> --target-kind <browser|windows> --target-identity <identity> --plan-id <id> --output <draft.json> --json",
];
export async function rpaCommand(args: Args, write: (value: unknown) => void, signal: AbortSignal) {
  const command = args.words.slice(0, 2).join(".");
  if (command === "rpa.checkpoints") {
    allow(args, ["json"], 2);
    return { code: 0, result: envelope(command, { checkpoints: await nativeUserOperation("rpa-checkpoints", {}, signal), modelApiCalled: false }) };
  }
  if (command === "rpa.checkpoint") {
    allow(args, ["plan", "json"], 3);
    const plan = args.options.has("plan") ? rpaPlanSchema.safeParse(await readJsonArtifact(required(args, "plan"), 65536)) : undefined;
    if (plan && !plan.success) throw new CliError(3, "BLK-RPA-PLAN-001", "RPA 计划无效。");
    return { code: 0, result: envelope(command, { checkpoint: await nativeUserOperation("rpa-checkpoint", { checkpointId: args.words[2], ...(plan?.success ? { plan: plan.data } : {}) }, signal), modelApiCalled: false }) };
  }
  if (command === "rpa.targets") {
    allow(args, ["json"], 2);
    return { code: 0, result: envelope(command, { targets: await nativeUserOperation("rpa-targets", {}, signal), modelApiCalled: false }) };
  }
  if (command === "rpa.run") {
    allow(args, ["inputs", "control-stdin", "jsonl"], 3);
    const parsed = rpaPlanSchema.safeParse(await readJsonArtifact(args.words[2], 65536));
    if (!parsed.success) throw new CliError(3, "BLK-RPA-PLAN-001", "RPA 计划无效。");
    const inputs = args.options.has("inputs") ? z.record(z.string(), z.string().max(16384)).parse(await readJsonArtifact(required(args, "inputs"), 65536)) : {};
    const outcome = await runNativeRpa(parsed.data, inputs, {
      signal, controlStdin: args.options.has("control-stdin"),
      onEvent: (message) => { if (args.options.has("jsonl")) write(message); },
    });
    const result = envelope(command, { ...outcome, modelApiCalled: false });
    result.ok = outcome.completed;
    if (!outcome.completed) result.error = { code: outcome.code ?? "BLK-RPA-WORKER-001", message: "自动化未完成。", path: "", hint: "查看 checkpoint 回执和目标窗口；状态 uncertain 的步骤不能自动重放。" };
    return { code: outcome.completed ? 0 : 7, result };
  }
  if (command === "rpa.validate") {
    allow(args, ["json"], 3);
    const result = rpaPlanSchema.safeParse(await readJsonArtifact(args.words[2], 65536));
    if (!result.success) throw new CliError(3, "BLK-RPA-PLAN-001", "RPA 计划无效。", "运行 schema show blocky.rpa/v1 核对字段。") ;
    return { code: 0, result: envelope(command, {
      planId: result.data.planId, targetKind: result.data.target.kind,
      actions: [...new Set(result.data.steps.map((step) => step.action))],
      steps: result.data.steps.length,
      coordinateFallback: result.data.steps.some((step) => step.locator.kind === "coordinate"),
      requiresAttendedApproval: true, modelApiCalled: false,
    }) };
  }
  if (command !== "rpa.recording-import") return;
  allow(args, ["target-kind", "target-identity", "plan-id", "output", "json"], 3);
  const recorded = z.array(z.object({
    action: z.enum(["find", "read", "click", "fill", "wait", "screenshot"]),
    locator: z.union([
      z.object({ kind: z.literal("browser"), role: z.string(), name: z.string().optional() }).strict(),
      z.object({ kind: z.literal("uia"), automationId: z.string().optional(), name: z.string().optional(), controlType: z.string().optional() }).strict(),
      z.object({ kind: z.literal("coordinate"), x: z.number(), y: z.number(), riskAccepted: z.literal(true) }).strict(),
    ]),
    sensitive: z.boolean().optional(),
    value: z.string().optional(),
  }).strict()).min(1).max(100).safeParse(await readJsonArtifact(args.words[2], 65536));
  if (!recorded.success) throw new CliError(3, "BLK-RPA-RECORD-001", "录制内容无效。");
  const draft = recordingToDraft(recorded.data as RecordedAction[]);
  const plan = rpaPlanSchema.safeParse({
    schemaVersion: "blocky.rpa/v1", planId: required(args, "plan-id"),
    target: { kind: required(args, "target-kind"), identity: required(args, "target-identity") },
    steps: draft.steps,
  });
  if (!plan.success) throw new CliError(3, "BLK-RPA-PLAN-001", "录制结果无法转换为计划，请检查定位器和目标。") ;
  const artifact = await writeJsonArtifact(required(args, "output"), {
    schemaVersion: "blocky.rpa-recording-draft/v1",
    requiresReview: true,
    plan: plan.data,
  });
  const result = envelope(command, { planId: plan.data.planId, steps: plan.data.steps.length, requiresReview: true, sensitiveInputStored: false, modelApiCalled: false });
  result.artifacts = [artifact];
  return { code: 0, result };
}
