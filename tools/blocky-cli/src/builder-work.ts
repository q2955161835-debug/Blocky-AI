import { runBuilderWork, ConversionScanner } from "@blocky/conversion-core";
import { builderWorkIds } from "@blocky/builder-protocol";
import { builderCommand } from "./builder";
import { readProject, nativeUserOperation } from "./native-store";
import { userRegistryMap } from "./user-config";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { allow, required, type Args } from "./arguments";
import { CliError, envelope } from "./protocol";
export const builderWorkHelp = [
  "builder work <work-id> <file.blocky> --input <request.json> --output <candidate-or-report.json> [--live --model <resource-id> --approve <digest> --turns 4] --json",
];
export async function builderWorkCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "builder" || args.words[1] !== "work") return;
  allow(
    args,
    ["input", "output", "live", "model", "approve", "turns", "json"],
    4,
  );
  const workId = args.words[2],
    file = args.words[3];
  if (!(builderWorkIds as readonly string[]).includes(workId))
    throw new CliError(2, "BLK-WORK-001", "未知工作标识。");
  if (
    workId !== "build-blocky-agents" &&
    ["live", "model", "approve", "turns"].some((k) => args.options.has(k))
  )
    throw new CliError(2, "BLK-WORK-001", "此工作不调用大模型。");
  const project = await readProject(file),
    registry = await userRegistryMap(),
    input = await readJsonArtifact(required(args, "input"));
  try {
    const result = await runBuilderWork(project, workId, input, {
      signal,
      registry,
      scanner: new ConversionScanner(
        nativeUserOperation,
        project.manifest.projectId,
      ),
      build: async (request) => {
        const options = new Map(args.options);
        options.delete("input");
        options.set("module", request.moduleId);
        options.set("prompt", request.prompt);
        options.set("request-id", request.requestId);
        if (request.selection.length)
          options.set("blocks", request.selection.join(","));
        if (request.createSurface) options.set("surface", true);
        return builderCommand(
          {
            words: [
              "builder",
              request.intent === "build" ? "draft" : request.intent,
              file,
            ],
            options,
          },
          signal,
        );
      },
    });
    if (workId === "build-blocky-agents")
      return result as Awaited<ReturnType<typeof builderCommand>>;
    const response = envelope(`builder.work.${workId}`, {
      modelApiCalled: false,
      applied: false,
    });
    response.artifacts = [
      await writeJsonArtifact(
        required(args, "output"),
        workId === "create-blocky-blocks"
          ? {
              schemaVersion: "blocky.builder-candidate/v1",
              ...(result as object),
            }
          : result,
      ),
    ];
    return { code: 0, result: response };
  } catch (error) {
    if (error instanceof CliError) throw error;
    const code = error instanceof Error ? error.message : "";
    throw new CliError(
      3,
      /^BLK-[A-Z0-9-]+$/.test(code) ? code : "BLK-WORK-001",
      "工作未完成；原项目保持不变。",
    );
  }
}
