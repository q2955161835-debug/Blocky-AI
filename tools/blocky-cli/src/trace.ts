import { inspectTraceExport } from "@blocky/observability";
import { allow, integer, type Args } from "./arguments";
import { readJsonArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";

export const traceHelp = [
  "trace inspect <trace.json> [--sequence <number>] --json",
  "trace replay <trace.json> --json",
];
export async function traceCommand(args: Args) {
  const command = args.words.slice(0, 2).join(".");
  if (command !== "trace.inspect" && command !== "trace.replay") return;
  allow(args, command === "trace.inspect" ? ["sequence", "json"] : ["json"], 3);
  let trace: ReturnType<typeof inspectTraceExport>;
  try { trace = inspectTraceExport(await readJsonArtifact(args.words[2], 2 * 1024 * 1024)); }
  catch { throw new CliError(3, "BLK-TRACE-003", "轨迹文件无效或超出上限。", "使用 run start --trace-output 重新导出轨迹。"); }
  const selected = command === "trace.inspect" && args.options.has("sequence")
    ? trace.frames.filter((frame) => frame.sequence === integer(args, "sequence", 1, Number.MAX_SAFE_INTEGER))
    : trace.frames;
  if (command === "trace.inspect" && args.options.has("sequence") && !selected.length)
    throw new CliError(3, "BLK-TRACE-004", "轨迹事件不存在。", "不传 --sequence 查看可用序号和丢弃计数。");
  return { code: 0, result: envelope(command, {
    runId: trace.runId, dropped: trace.dropped, frames: selected,
    replayOnly: command === "trace.replay", externalCalls: 0, modelApiCalled: false,
  }) };
}
