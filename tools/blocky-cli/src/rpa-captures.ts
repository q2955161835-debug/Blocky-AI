import { createHash } from "node:crypto";
import { rpaCaptureIdSchema, rpaCaptureSchema, rpaCaptureViewSchema } from "@blocky/rpa-core";
import { allow, required, type Args } from "./arguments";
import { nativeUserOperation } from "./native-store";
import { writeBinaryArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";
export async function captureCommand(args: Args, signal: AbortSignal) {
  const command = args.words.slice(0, 2).join(".");
  if (command === "rpa.captures") {
    allow(args, ["json"], 2);
    const captures = rpaCaptureSchema.array().max(32).parse(await nativeUserOperation("rpa-captures", {}, signal));
    return { code: 0, result: envelope(command, { captures, modelApiCalled: false }) };
  }
  if (!["rpa.capture-export", "rpa.capture-delete"].includes(command)) return;
  allow(args, command === "rpa.capture-export" ? ["output", "json"] : ["json"], 3);
  const id = rpaCaptureIdSchema.safeParse(args.words[2]);
  if (!id.success) throw new CliError(3, "BLK-RPA-CAPTURE-002", "截图标识无效。", "先运行 rpa captures 获取当前资料目录中的记录。");
  if (command === "rpa.capture-delete") return { code: 0, result: envelope(command, { deletion: await nativeUserOperation("rpa-capture-delete", { captureId: id.data }, signal), modelApiCalled: false }) };
  const output = required(args, "output");
  const image = rpaCaptureViewSchema.parse(await nativeUserOperation("rpa-capture-read", { captureId: id.data }, signal));
  const bytes = Buffer.from(image.dataUrl.slice(22), "base64");
  try {
    if (image.capture.captureId !== id.data || bytes.length !== image.capture.bytes || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || createHash("sha256").update(bytes).digest("hex") !== image.capture.sha256) throw new CliError(3, "BLK-RPA-CAPTURE-002", "截图完整性校验失败。");
    signal.throwIfAborted();
    const result = envelope(command, { capture: image.capture, exported: true, modelApiCalled: false });
    result.artifacts = [await writeBinaryArtifact(output, bytes)];
    return { code: 0, result };
  } finally { bytes.fill(0); }
}
