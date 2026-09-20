import {
  inspectBuilder,
  parseBuilderRequest,
  previewPatch,
} from "@blocky/builder-protocol";
import { canonicalJson } from "@blocky/language-schema";
import { readProject, nativeUserOperation } from "./native-store";
import { userRegistryMap } from "./user-config";
import { readJsonArtifact, writeJsonArtifact } from "./artifacts";
import { allow, required, integer, type Args } from "./arguments";
import { CliError, envelope } from "./protocol";

export const builderHelp = [
  "builder evidence --request-id <id> --json",
  "builder inspect <file.blocky> --module <id> [--blocks <id,id>] --json",
  "builder draft|explain|repair <file.blocky> --module <id> --prompt <text> [--blocks <id,id>] [--surface] [--live --model <resource-id> --request-id <id> --approve <request-digest>] [--turns 4] --output <candidate.json> --json",
  "builder patch|verify <file.blocky> --candidate <candidate.json> --json",
];
export async function builderCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "builder") return;
  const action = args.words[1],
    command = `builder.${action}`;
  if (action === "evidence") {
    allow(args, ["request-id", "json"], 2);
    return {
      code: 0,
      result: envelope(
        command,
        await nativeUserOperation(
          "builder-evidence",
          { requestId: required(args, "request-id") },
          signal,
        ),
      ),
    };
  }
  if (
    ![
      "inspect",
      "draft",
      "build",
      "explain",
      "repair",
      "patch",
      "verify",
    ].includes(action)
  )
    throw new CliError(2, "BLK-CLI-002", "构建命令不存在。");
  const review = action === "patch" || action === "verify";
  allow(
    args,
    review
      ? ["candidate", "json"]
      : action === "inspect"
        ? ["module", "blocks", "json"]
        : [
            "module",
            "prompt",
            "blocks",
            "surface",
            "live",
            "model",
            "request-id",
            "approve",
            "turns",
            "output",
            "json",
          ],
    3,
  );
  const project = await readProject(args.words[2]),
    registry = await userRegistryMap();
  signal.throwIfAborted();
  try {
    if (review) {
      const candidate = (await readJsonArtifact(
        required(args, "candidate"),
      )) as { patch?: unknown };
      const checked = await previewPatch(
        project,
        candidate.patch ?? candidate,
        registry,
      );
      return {
        code: 0,
        result: envelope(command, {
          passed: true,
          patch: checked.patch,
          changes: checked.changes,
          permissionDelta: checked.permissionDelta,
          diagnostics: checked.diagnostics,
          applied: false,
        }),
      };
    }
    const live = args.options.has("live");
    const request = parseBuilderRequest({
      schemaVersion: "blocky.builder-request/v1",
      requestId:
        typeof args.options.get("request-id") === "string"
          ? args.options.get("request-id")
          : `builder-${crypto.randomUUID()}`,
      projectId: project.manifest.projectId,
      moduleId: required(args, "module"),
      intent:
        action === "explain"
          ? "explain"
          : action === "repair"
            ? "repair"
            : "build",
      prompt: action === "inspect" ? "检查当前模块" : required(args, "prompt"),
      selection: String(args.options.get("blocks") ?? "")
        .split(",")
        .filter(Boolean),
      createSurface: args.options.has("surface"),
    });
    if (action === "inspect")
      return {
        code: 0,
        result: envelope(
          command,
          await inspectBuilder(project, request, registry),
        ),
      };
    const output = required(args, "output");
    if (live && !args.options.has("request-id"))
      throw new CliError(
        2,
        "BLK-CLI-002",
        "真实构建需要 --request-id，以便绑定预检与批准。",
      );
    const start = {
      request,
      originalJson: canonicalJson(project),
      mode: live ? "live" : "deterministic",
      resourceId: live ? required(args, "model") : null,
      maxTurns: integer(args, "turns", 4, 4),
    };
    if (live && !args.options.has("approve")) {
      const preview = await nativeUserOperation(
        "builder-preflight",
        { start },
        signal,
      );
      return {
        code: 4,
        result: envelope(command, {
          pendingApproval: preview,
          modelApiCalled: false,
          applied: false,
        }),
      };
    }
    const result = (await nativeUserOperation(
      "builder-run",
      {
        start,
        ...(live
          ? {
              approval: {
                approved: true,
                requestDigest: required(args, "approve"),
              },
            }
          : {}),
      },
      signal,
    )) as Record<string, unknown>;
    signal.throwIfAborted();
    const artifact = await writeJsonArtifact(output, {
      schemaVersion: "blocky.builder-candidate/v1",
      ...result,
    });
    const response = envelope(command, {
      requestId: request.requestId,
      modelApiCalled: result.modelApiCalled,
      generations: result.generations,
      verification: result.verification,
      applied: false,
    });
    response.artifacts = [artifact];
    return { code: 0, result: response };
  } catch (error) {
    if (error instanceof CliError) throw error;
    const message = error instanceof Error ? error.message : "";
    throw new CliError(
      3,
      /^BLK-[A-Z0-9-]+$/.test(message) ? message : "BLK-BUILDER-001",
      "构建未完成；原项目保持不变。",
    );
  }
}
