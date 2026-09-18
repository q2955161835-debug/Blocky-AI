import {
  ConversionScanner,
  realConversionCandidate,
  artifactSchema,
  type SourceArtifact,
} from "@blocky/conversion-core";
import { type Args, allow, required } from "./arguments";
import { readProject, nativeUserOperation } from "./native-store";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { envelope, CliError } from "./protocol";
import { userRegistryMap } from "./user-config";
import { resolve } from "node:path";
export const conversionHelp = [
  "conversion scan <project.blocky> --repo <directory> [--ref <commit>] [--subdir <path>] --output <snapshot-ref.json> --json",
  "conversion inspect <project.blocky> --snapshot <snapshot-ref.json> [--output <report.json>] --json",
  "conversion candidate <project.blocky> --snapshot <snapshot-ref.json> --file <source/path> --symbol <name> --line <number> --module <id> --output <candidate.json> --json",
  "conversion cancel <project.blocky> --json",
];
export async function conversion(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "conversion" || args.options.has("fixture")) return;
  const action = args.words[1],
    command = `conversion.${action}`;
  const options: Record<string, string[]> = {
    scan: ["repo", "ref", "subdir", "output", "json"],
    inspect: ["snapshot", "output", "json"],
    candidate: [
      "snapshot",
      "file",
      "symbol",
      "line",
      "module",
      "output",
      "json",
    ],
    cancel: ["json"],
  };
  if (!options[action]) throw new CliError(2, "BLK-CLI-002", "未知转换命令。");
  allow(args, options[action], 3);
  const project = await readProject(args.words[2]);
  const scanner = new ConversionScanner(
    nativeUserOperation,
    project.manifest.projectId,
  );
  try {
    if (action === "cancel")
      return { code: 0, result: envelope(command, await scanner.cancel()) };
    let artifact: SourceArtifact;
    if (action === "scan") {
      artifact = await scanner.scan(
        {
          path: resolve(required(args, "repo")),
          ...(args.options.has("ref") ? { ref: required(args, "ref") } : {}),
          ...(args.options.has("subdir")
            ? { subdir: required(args, "subdir") }
            : {}),
        },
        signal,
      );
      const report = await scanner.analyze(artifact, signal);
      const result = envelope(command, {
        artifact,
        stats: report.stats,
        license: report.licenseStatus,
        decisions: report.files
          .flatMap((f) => f.symbols)
          .reduce(
            (counts, s) => ({
              ...counts,
              [s.decision]: (counts[s.decision] ?? 0) + 1,
            }),
            {} as Record<string, number>,
          ),
        changes: report.changes,
        modelApiCalled: false,
      });
      result.artifacts = [
        await writeJsonArtifact(required(args, "output"), artifact),
      ];
      return { code: 0, result };
    }
    artifact = artifactSchema.parse(
      await readJsonArtifact(required(args, "snapshot")),
    );
    const report = await scanner.analyze(artifact, signal);
    if (action === "inspect") {
      const result = envelope(command, {
        artifact,
        stats: report.stats,
        license: report.licenseStatus,
        changes: report.changes,
        workingTree: report.workingTree,
        dependencies: report.dependencies,
        reportStored: true,
        symbols: report.files
          .flatMap((f) =>
            f.symbols.map((s) => ({
              file: f.path,
              name: s.name,
              lineStart: s.lineStart,
              decision: s.decision,
            })),
          )
          .slice(0, 100),
        symbolCount: report.evidenceMap.entries.length,
      });
      if (args.options.has("output"))
        result.artifacts = [
          await writeJsonArtifact(required(args, "output"), report),
        ];
      return { code: 0, result };
    }
    const lineStart = Number(required(args, "line"));
    if (!Number.isSafeInteger(lineStart) || lineStart < 1)
      throw new CliError(2, "BLK-CLI-002", "源码行号无效。");
    const registry = project.manifest.resources.some((r) => r.scope === "user")
      ? await userRegistryMap()
      : undefined;
    const candidate = await realConversionCandidate(
      project,
      required(args, "module"),
      report,
      {
        file: required(args, "file"),
        symbol: required(args, "symbol"),
        lineStart,
      },
      scanner,
      signal,
      registry,
    );
    const result = envelope(command, {
      candidateId: candidate.candidateId,
      artifactType: candidate.artifactType,
      source: candidate.source,
      interface: candidate.interface,
      modelApiCalled: false,
    });
    result.artifacts = [
      await writeJsonArtifact(required(args, "output"), candidate),
    ];
    return { code: 0, result };
  } catch (error) {
    if (signal.aborted)
      throw new CliError(
        7,
        "BLK-CONVERT-CANCELLED",
        "转换已取消，可从已保存快照重新分析。",
      );
    if (error instanceof Error && /^BLK-CONVERT-/.test(error.message))
      throw new CliError(
        3,
        error.message,
        "转换无法继续。检查来源、许可证、预算和符号边界；原项目未修改。",
      );
    throw error;
  }
}
