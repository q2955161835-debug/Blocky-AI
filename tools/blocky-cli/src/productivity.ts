import { canonicalJson } from "@blocky/language-schema";
import { projectDigest } from "@blocky/project-model";
import { compileProject } from "@blocky/compiler";
import { makePatch, previewPatch } from "@blocky/builder-protocol";
import { readProject, createProject, validatePatch } from "./native-store";
import { readJsonArtifact, writeJsonArtifact, artifactInfo } from "./artifacts";
import { allow, required, type Args } from "./arguments";
import { envelope, CliError } from "./protocol";
import { userRegistryMap } from "./user-config";
import { operationsInput } from "./discovery";
import { pageBounds } from "./block-query";
import { projectChanges } from "./project-diff";
import { errorGuidance } from "./error-guidance";
export const productivityHelp = [
  "patch create <file.blocky> --operations <operations.json> --output <patch.json> --json",
  "project diff <before.blocky> <after.blocky> [--limit 100] [--cursor 0] --json",
  "project checkpoint <file.blocky> --output <checkpoint.blocky> --json",
  "project restore <current.blocky> --checkpoint <checkpoint.blocky> --expect-digest <current-digest> --output <new.blocky> --json",
];
export async function productivityCommand(args: Args, signal: AbortSignal) {
  const command = args.words.slice(0, 2).join(".");
  if (
    ![
      "patch.create",
      "project.diff",
      "project.checkpoint",
      "project.restore",
    ].includes(command)
  )
    return;
  const options: Record<string, string[]> = {
    "patch.create": ["operations", "output"],
    "project.diff": ["limit", "cursor"],
    "project.checkpoint": ["output"],
    "project.restore": ["checkpoint", "expect-digest", "output"],
  };
  allow(
    args,
    ["json", ...options[command]],
    command === "project.diff" ? 4 : 3,
  );
  signal.throwIfAborted();
  const project = await readProject(args.words[2]),
    digest = await projectDigest(project);
  if (command === "project.diff") {
    const after = await readProject(args.words[3]);
    if (project.manifest.projectId !== after.manifest.projectId)
      throw new CliError(3, "BLK-REF-001", "只能比较同一项目的两个版本。");
    let changes;
    try {
      changes = projectChanges(project, after);
    } catch {
      throw new CliError(3, "BLK-CLI-DIFF-LIMIT", "项目差异超出处理上限。");
    }
    const page = pageBounds(args, changes.length),
      result = envelope(command, {
        projectId: project.manifest.projectId,
        beforeDigest: digest,
        afterDigest: await projectDigest(after),
        same: changes.length === 0,
        total: changes.length,
        changes: changes.slice(page.start, page.start + page.limit),
      });
    result.nextCursor = page.nextCursor;
    return { code: 0, result };
  }
  const output = required(args, "output");
  const registry = project.manifest.resources.some((r) => r.scope === "user")
    ? await userRegistryMap()
    : undefined;
  if (command === "patch.create") {
    const parsed = operationsInput.safeParse(
      await readJsonArtifact(required(args, "operations")),
    );
    if (!parsed.success) {
      const index = parsed.error.issues[0]?.path[0];
      throw new CliError(
        3,
        "BLK-PATCH-002",
        `批量编辑格式无效${typeof index === "number" ? `（第 ${index + 1} 项）` : ""}；未写入候选。`,
        "运行 schema show blocky.cli-operations/v1 获取严格输入格式。",
      );
    }
    try {
      const patch = await makePatch(project, parsed.data, registry);
      const review = await previewPatch(project, patch, registry);
      const native = await validatePatch(project, patch, patch.permissionDelta);
      if (canonicalJson(native) !== canonicalJson(review.next))
        throw Error("BLK-PATCH-002");
      signal.throwIfAborted();
      const result = envelope(command, {
        patch,
        changes: review.changes,
        diagnostics: review.diagnostics,
        permissionDelta: patch.permissionDelta,
        applied: false,
        modelApiCalled: false,
      });
      result.artifacts = [await writeJsonArtifact(output, patch)];
      return { code: 0, result };
    } catch (error) {
      if (error instanceof CliError) throw error;
      const code =
        error instanceof Error && /^BLK-[A-Z0-9-]+$/.test(error.message)
          ? error.message
          : "BLK-PATCH-002";
      const advice = errorGuidance(code);
      throw new CliError(
        3,
        code,
        advice?.message ?? "批量编辑失败；原项目与输出保持不变。",
        advice?.hint,
      );
    }
  }
  let restored = project;
  if (command === "project.restore") {
    if (required(args, "expect-digest") !== digest)
      throw new CliError(
        5,
        "BLK-PATCH-001",
        "当前项目摘要与恢复请求不一致。",
        errorGuidance("BLK-PATCH-001")!.hint,
      );
    restored = await readProject(required(args, "checkpoint"));
    if (restored.manifest.projectId !== project.manifest.projectId)
      throw new CliError(3, "BLK-REF-001", "检查点属于另一个项目，未恢复。");
  }
  const compiled = await compileProject(
    restored,
    restored.manifest.resources.some(r => r.scope === "user")
      ? await userRegistryMap()
      : undefined,
  );
  // Publication never overwrites the source or an existing destination.
  if ((await projectDigest(await readProject(args.words[2]))) !== digest)
    throw new CliError(
      5,
      "BLK-PATCH-001",
      "源项目在操作期间已改变，未写入输出。",
    );
  signal.throwIfAborted();
  await createProject(output, restored);
  const result = envelope(command, {
    projectId: restored.manifest.projectId,
    beforeDigest: digest,
    digest: await projectDigest(restored),
    diagnostics: compiled.diagnostics,
    originalPreserved: true,
    modelApiCalled: false,
  });
  result.artifacts = [await artifactInfo(output)];
  if (compiled.diagnostics.some((d) => d.severity === "error"))
    result.warnings.push(
      "检查点包含编辑中的诊断；恢复不会自动运行或重放副作用。",
    );
  return { code: 0, result };
}
