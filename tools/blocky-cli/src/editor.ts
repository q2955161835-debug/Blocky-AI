import { affectedModules, copyAcrossModules, editSelection, editorOperationSchema, projectDigest, projectMap } from "@blocky/project-model";
import { allow, required, type Args } from "./arguments";
import { readJsonArtifact, artifactInfo } from "./artifacts";
import { createProject, readProject } from "./native-store";
import { CliError, envelope } from "./protocol";

export const editorHelp = [
  "project map <file.blocky> --json",
  "project edit <file.blocky> --operations <editor-operations.json> --expect-digest <sha256> --output <new.blocky> --json",
];

export async function editorCommand(args: Args, signal: AbortSignal) {
  if (args.words.slice(0, 2).join(".") === "project.map") {
    allow(args, ["json"], 3);
    const project = await readProject(args.words[2]);
    const modules = projectMap(project);
    return { code: 0, result: envelope("project.map", {
      projectId: project.manifest.projectId,
      modules: modules.map((module) => ({ ...module, affected: affectedModules(project, module.moduleId) })),
      modelApiCalled: false,
    }) };
  }
  if (args.words.slice(0, 2).join(".") !== "project.edit") return;
  allow(args, ["operations", "expect-digest", "output", "json"], 3);
  const original = await readProject(args.words[2]);
  const beforeDigest = await projectDigest(original);
  if (required(args, "expect-digest") !== beforeDigest)
    throw new CliError(5, "BLK-CONFLICT-001", "项目已变化，未生成编辑结果。", "重新运行 project inspect 后使用当前摘要。");
  const raw = await readJsonArtifact(required(args, "operations"), 65536);
  const operations = editorOperationSchema.array().min(1).max(100).safeParse(raw);
  if (!operations.success)
    throw new CliError(2, "BLK-EDIT-002", "编辑操作不符合 blocky.editor-operation/v1。", "使用 schema show blocky.editor-operation/v1 查看字段。");
  const result = structuredClone(original);
  const added: string[] = [];
  try {
    for (const operation of operations.data) {
      signal.throwIfAborted();
      if (operation.kind === "edit") {
        const workspace = result.workspaces[operation.moduleId];
        if (!workspace) throw Error("BLK-EDIT-001");
        editSelection(workspace, operation.ids, operation.edit);
      } else {
        added.push(...copyAcrossModules(
          result, operation.sourceModuleId, operation.targetModuleId, operation.ids,
          () => `block-${crypto.randomUUID()}`,
        ));
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CliError(3, "BLK-EDIT-001", "编辑操作未完成，原项目未修改。", "检查模块、顶层积木 ID 与操作字段。");
  }
  signal.throwIfAborted();
  const afterDigest = await projectDigest(result);
  if (afterDigest === beforeDigest)
    throw new CliError(3, "BLK-EDIT-001", "编辑没有产生变化，原项目未修改。");
  const output = required(args, "output");
  await createProject(output, result);
  const readBack = await readProject(output);
  if (await projectDigest(readBack) !== afterDigest)
    throw new CliError(6, "BLK-SAVE-001", "新项目写入后校验失败，请勿将其用于交付。");
  const response = envelope("project.edit", {
    projectId: result.manifest.projectId,
    beforeDigest,
    afterDigest,
    operations: operations.data.length,
    addedBlockIds: added,
    modelApiCalled: false,
  });
  response.artifacts = [await artifactInfo(output)];
  return { code: 0, result: response };
}
