import { recordingToDraft, rpaPlanSchema, rpaRecoverySchema, rpaBrowserStartSchema, rpaCheckpointDeleteSchema, planToRpaBlocks, type RecordedAction } from "@blocky/rpa-core";
import { z } from "zod";
import { allow, required, type Args } from "./arguments";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";
import { nativeUserOperation, readProject } from "./native-store";
import { makePatch, previewPatch } from "@blocky/builder-protocol";
import { userRegistryMap } from "./user-config";
import { runNativeRpa } from "./rpa-transport";
import { recordingReview, rpaRecordingStartSchema } from "@blocky/rpa-core/recording";
import { recordNativeRpa } from "./rpa-recording-transport";
import { captureCommand } from "./rpa-captures";

export const rpaHelp = [
  "rpa captures --json",
  "rpa capture-export <capture-id> --output <new.png> --json",
  "rpa capture-delete <capture-id> --json",
  "rpa draft <project.blocky> --plan <plan.json> --module <id> [--browser-url <url>] --output <patch.json> --json",
  "rpa record <request.json> --control-stdin --output <recording.json> --jsonl",
  "rpa recording-draft <project.blocky> --recording <recording.json> --request <request.json> --module <id> --output <patch.json> --json",
  "rpa targets --json",
  "rpa checkpoints --json",
  "rpa recovery-preview <checkpoint-id> --json",
  "rpa recover <plan.json> --recovery <recovery.json> [--inputs <step-inputs.json>] [--control-stdin] --jsonl",
  "rpa checkpoint <checkpoint-id> [--plan <plan.json>] --json",
  "rpa checkpoint-delete <checkpoint-id> --revision <number> --json",
  "rpa run <plan.json> [--browser-url <url> --project-id <id>] [--inputs <step-inputs.json>] [--control-stdin] --jsonl",
  "rpa validate <plan.json> --json",
  "rpa recording-import <recording.json> --target-kind <browser|windows> --target-identity <identity> --plan-id <id> --output <draft.json> --json",
];
export async function rpaCommand(args: Args, write: (value: unknown) => void, signal: AbortSignal) {
  const capture = await captureCommand(args, signal); if (capture) return capture;
  const command = args.words.slice(0, 2).join(".");
  if (command === "rpa.record") {
    allow(args, ["control-stdin", "output", "jsonl"], 3);
    if (!args.options.has("control-stdin") || !args.options.has("jsonl")) throw new CliError(2, "BLK-CLI-002", "录制需要 --control-stdin 和 --jsonl。", "同一会话 stdin 接受 {operation: status} 或 {operation: stop} 的 JSON 行；关闭 stdin 也会停止。");
    const output = required(args, "output");
    const request = rpaRecordingStartSchema.safeParse(await readJsonArtifact(args.words[2], 65536));
    if (!request.success) throw new CliError(3, "BLK-RPA-RECORD-001", "录制请求无效。", "使用 schema show blocky.rpa-recording-start/v1；sessionId 每次使用新的稳定 ID。");
    let recording;
    try { recording = await recordNativeRpa(request.data, { signal, controlStdin: true, onEvent: write }); }
    catch (error) { throw new CliError(7, String(error).match(/BLK-RPA-[A-Z0-9-]+/)?.[0] ?? "BLK-RPA-WORKER-001", "录制未完成。", "根据错误码核对录制会话；没有写入录制工件，执行权限未授予。"); }
    const result = envelope(command, { sessionId: request.data.sessionId, settled: true, recorded: !!recording, count: recording?.actions.length ?? 0, requiresReview: true, modelApiCalled: false });
    if (recording) result.artifacts = [await writeJsonArtifact(output, recording)];
    return { code: 0, result };
  }
  if (command === "rpa.draft" || command === "rpa.recording-draft") {
    const recorded = command === "rpa.recording-draft";
    allow(args,[...(recorded ? ["recording", "request"] : ["plan", "browser-url"]),"module","output","json"],3);
    const project=await readProject(args.words[2]), registry=await userRegistryMap();
    const request = recorded ? rpaRecordingStartSchema.parse(await readJsonArtifact(required(args,"request"),65536)) : undefined;
    if (request && request.projectId !== project.manifest.projectId) throw new CliError(3,"BLK-RPA-TARGET-001","录制所属项目与当前项目不同。");
    const reviewDraft = request ? recordingReview(await readJsonArtifact(required(args,"recording"),262144),request) : {plan:rpaPlanSchema.parse(await readJsonArtifact(required(args,"plan"),65536)),browserUrl:args.options.has("browser-url")?required(args,"browser-url"):undefined};
    const root=planToRpaBlocks(reviewDraft.plan,reviewDraft.browserUrl);
    const patch=await makePatch(project,[{op:"block.add",moduleId:required(args,"module"),blockId:root.id,payload:root}],registry);
    const review=await previewPatch(project,patch,registry);
    const artifact=await writeJsonArtifact(required(args,"output"),patch);
    const result=envelope(command,{requiresReview:true,permissionDelta:review.permissionDelta,modelApiCalled:false});result.artifacts=[artifact];
    return {code:0,result};
  }
  if (command === "rpa.recovery-preview") {
    allow(args, ["json"], 3);
    return { code: 0, result: envelope(command, { preview: await nativeUserOperation("rpa-recovery-preview", { checkpointId: args.words[2] }, signal), modelApiCalled: false }) };
  }
  if (command === "rpa.checkpoint-delete") {
    allow(args, ["revision", "json"], 3);
    const deletion = rpaCheckpointDeleteSchema.safeParse({ schemaVersion: "blocky.rpa-checkpoint-delete/v1", checkpointId: args.words[2], revision: Number(required(args, "revision")) });
    if (!deletion.success) throw new CliError(3, "BLK-RPA-JOURNAL-002", "执行记录删除请求无效。", "先运行 rpa checkpoint，使用当前记录的 ID 和 revision。");
    return { code: 0, result: envelope(command, { deletion: await nativeUserOperation("rpa-checkpoint-delete", { deletion: deletion.data }, signal), modelApiCalled: false }) };
  }
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
  if (command === "rpa.run" || command === "rpa.recover") {
    allow(args, ["inputs", "control-stdin", "jsonl", ...(command === "rpa.recover" ? ["recovery"] : ["browser-url","project-id"])], 3);
    const recovery = command === "rpa.recover" ? rpaRecoverySchema.safeParse(await readJsonArtifact(required(args, "recovery"), 32768)) : undefined;
    if (recovery && !recovery.success) throw new CliError(3, "BLK-RPA-RECOVERY-003", "恢复条件无效。");
    const parsed = rpaPlanSchema.safeParse(await readJsonArtifact(args.words[2], 65536));
    if (!parsed.success) throw new CliError(3, "BLK-RPA-PLAN-001", "RPA 计划无效。");
    const browser = args.options.has("browser-url") || args.options.has("project-id") ? rpaBrowserStartSchema.safeParse({url:required(args,"browser-url"),projectId:required(args,"project-id")}) : undefined;
    if (browser && (!browser.success || parsed.data.target.kind!=="browser" || parsed.data.target.identity!==new URL(browser.data.url).origin)) throw new CliError(3,"BLK-RPA-TARGET-001","浏览器起点与计划来源不一致。","target.identity 应为网址的 origin；同时提供 --browser-url 和 --project-id。");
    const inputs = args.options.has("inputs") ? z.record(z.string(), z.string().max(16384)).parse(await readJsonArtifact(required(args, "inputs"), 65536)) : {};
    const outcome = await runNativeRpa(parsed.data, inputs, {
      signal, controlStdin: args.options.has("control-stdin"),
      recovery: recovery?.success ? recovery.data : undefined,
      browser: browser?.success ? browser.data : undefined,
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
  const draft = recordingToDraft(recorded.data as RecordedAction[], { includeSensitivePurpose: true });
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
