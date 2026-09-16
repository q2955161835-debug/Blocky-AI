import { diagnosticRecord, type LogRecord } from "@blocky/observability";
import { allow, required, type Args } from "./arguments";
import { CliError, envelope } from "./protocol";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
export async function exportDiagnostics(args: Args) {
  if (args.words.slice(0, 2).join(".") !== "diagnostics.export") return;
  allow(args, ["output", "json", "channel", "from", "to"], 3);
  const input = await readJsonArtifact(args.words[2], 25601024);
  try {
    const raw = Array.isArray(input)
      ? input
      : input && typeof input === "object" && "records" in input
        ? input.records
        : undefined;
    if (!Array.isArray(raw) || raw.length > 100000) throw Error();
    const counts =
      input && !Array.isArray(input) && typeof input === "object"
        ? (input as {
            dropped?: unknown;
            droppedImportant?: unknown;
            clearAudit?: unknown;
          })
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
    let clearAudit: { count: number; lastClearedAtMs: number } | undefined;
    if (counts.clearAudit !== undefined) {
      const audit = counts.clearAudit as Record<string, unknown>;
      if (
        !audit ||
        typeof audit !== "object" ||
        Array.isArray(audit) ||
        Object.keys(audit).some(
          (key) => !["count", "lastClearedAtMs"].includes(key),
        ) ||
        typeof audit.count !== "number" ||
        !Number.isSafeInteger(audit.count) ||
        audit.count < 0 ||
        typeof audit.lastClearedAtMs !== "number" ||
        !Number.isSafeInteger(audit.lastClearedAtMs) ||
        audit.lastClearedAtMs < 0 ||
        (audit.count === 0) !== (audit.lastClearedAtMs === 0)
      )
        throw Error();
      clearAudit = {
        count: audit.count,
        lastClearedAtMs: audit.lastClearedAtMs,
      };
    }
    let records = raw.map((record) => diagnosticRecord(record as LogRecord));
    const from = args.options.get("from"),
      to = args.options.get("to");
    for (const value of [from, to])
      if (
        value !== undefined &&
        (typeof value !== "string" ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString() !== value)
      )
        throw Error();
    if (typeof from === "string" && typeof to === "string" && from > to)
      throw Error();
    records = records.filter(
      (r) =>
        (typeof from !== "string" || r.timestamp >= from) &&
        (typeof to !== "string" || r.timestamp <= to),
    );
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
      ...(clearAudit ? { clearAudit } : {}),
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
