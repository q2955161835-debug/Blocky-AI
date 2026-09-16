import { diagnosticRecord, type LogRecord } from "@blocky/observability";
import { allow, required, type Args } from "./arguments";
import { CliError, envelope } from "./protocol";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
export async function exportDiagnostics(args: Args) {
  if (args.words.slice(0, 2).join(".") !== "diagnostics.export") return;
  allow(args, ["output", "json", "channel"], 3);
  const input = await readJsonArtifact(args.words[2]);
  try {
    const raw = Array.isArray(input)
      ? input
      : input && typeof input === "object" && "records" in input
        ? input.records
        : undefined;
    if (!Array.isArray(raw) || raw.length > 1000) throw Error();
    const counts =
      input && !Array.isArray(input) && typeof input === "object"
        ? (input as { dropped?: unknown; droppedImportant?: unknown })
        : {};
    const dropped = counts.dropped ?? 0,
      droppedImportant = counts.droppedImportant ?? 0;
    if (
      typeof dropped !== "number" ||
      typeof droppedImportant !== "number" ||
      !Number.isSafeInteger(dropped) ||
      !Number.isSafeInteger(droppedImportant) ||
      dropped < 0 ||
      droppedImportant < 0 ||
      droppedImportant > dropped
    )
      throw Error();
    let records = raw.map((record) => diagnosticRecord(record as LogRecord));
    const channel = args.options.get("channel");
    if (channel !== undefined) {
      if (
        ![
          "runtime",
          "compiler",
          "host",
          "terminal",
          "preview",
          "builder",
        ].includes(String(channel))
      )
        throw Error();
      records = records.filter((r) => r.channel === channel);
    }
    const artifact = {
      schemaVersion: "blocky.diagnostics/v1",
      records,
      dropped,
      droppedImportant,
    };
    const result = envelope("diagnostics.export", {
      recordCount: records.length,
      modelApiCalled: false,
    });
    result.artifacts = [
      await writeJsonArtifact(required(args, "output"), artifact),
    ];
    return { code: 0, result };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(3, "BLK-LOG-004", "诊断输入未通过字段白名单校验。");
  }
}
