import {
  ProjectController,
  configureBlock,
  projectDigest,
} from "@blocky/project-model";
import { compileProject } from "@blocky/compiler";
import { createProject, readProject } from "./native-store";
import { type Args, allow, required } from "./arguments";
import { envelope, CliError } from "./protocol";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function configure(args: Args) {
  allow(args, ["module", "block", "field", "value", "output", "json"], 3);
  const project = await readProject(args.words[2]);
  const controller = new ProjectController(project);
  const moduleId = required(args, "module"),
    blockId = required(args, "block"),
    field = required(args, "field"),
    value = required(args, "value"),
    target = required(args, "output");
  try {
    controller.edit((p) => configureBlock(p, moduleId, blockId, field, value));
  } catch {
    throw new CliError(3, "BLK-CONFIG-001", "目标积木、字段或配置值无效。");
  }
  const next = controller.getSnapshot().project;
  const compiled = await compileProject(next);
  await createProject(target, next);
  const bytes = await readFile(target);
  const result = envelope("project.configure", {
    digest: await projectDigest(next),
    diagnostics: compiled.diagnostics,
    changed: controller.getSnapshot().dirty,
  });
  result.artifacts = [
    {
      path: basename(target),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  if (compiled.diagnostics.some((d) => d.severity === "error"))
    result.warnings.push("项目已保存，但包含编译错误；运行前需要修复。");
  return { code: 0, result };
}
