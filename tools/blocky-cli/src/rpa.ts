import { recordingToDraft, rpaPlanSchema, type RecordedAction } from "@blocky/rpa-core";
import { z } from "zod";
import { allow, required, type Args } from "./arguments";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";

export const rpaHelp = [
  "rpa validate <plan.json> --json",
  "rpa recording-import <recording.json> --target-kind <browser|windows> --target-identity <identity> --plan-id <id> --output <draft.json> --json",
];
export async function rpaCommand(args: Args) {
  const command = args.words.slice(0, 2).join(".");
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
