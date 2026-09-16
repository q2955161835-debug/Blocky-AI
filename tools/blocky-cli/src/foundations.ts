import { readFile } from "node:fs/promises";
import {
  createModule,
  deleteModule,
  renameModule,
  projectDigest,
} from "@blocky/project-model";
import {
  createSettings,
  parseSettings,
  resetSetting,
  updateSetting,
  settingDefinitions,
  resolveSetting,
} from "@blocky/settings-core";
import {
  resourceDefinitions,
  upsertProjectResource,
  removeProjectResource,
  analyzeResourceReferences,
} from "@blocky/resource-registry";
import { compileProject } from "@blocky/compiler";
import { readProject, createProject } from "./native-store";
import { allow, required, type Args } from "./arguments";
import { envelope, CliError } from "./protocol";
export const foundationsHelp = [
  "project module create <file.blocky> --id <id> --name <name> --output <new.blocky> --json",
  "project module rename <file.blocky> --id <id> --name <name> --output <new.blocky> --json",
  "project module delete <file.blocky> --id <id> --output <new.blocky> --json",
  "project settings list <file.blocky> --json",
  "project settings set <file.blocky> --id <setting> --value <JSON> --output <new.blocky> --json",
  "project settings reset <file.blocky> --id <setting> --output <new.blocky> --json",
  "project resource list <file.blocky> --json",
  "project resource set <file.blocky> --definition <resource.json> --output <new.blocky> --json",
  "project resource delete <file.blocky> --id <id> --output <new.blocky> --json",
  "project resource references <file.blocky> --id <id> --json",
];
export async function foundationsCommand(args: Args) {
  if (args.words[0] !== "project") return;
  const family = args.words[1],
    action = args.words[2],
    command = args.words.slice(0, 3).join(".");
  if (
    !["module", "settings", "resource"].includes(family) ||
    (family === "module" && action === "list")
  )
    return;
  const options: Record<string, string[]> = {
    "module.create": ["id", "name", "output"],
    "module.rename": ["id", "name", "output"],
    "module.delete": ["id", "output"],
    "settings.list": [],
    "settings.set": ["id", "value", "output"],
    "settings.reset": ["id", "output"],
    "resource.list": [],
    "resource.set": ["definition", "output"],
    "resource.delete": ["id", "output"],
    "resource.references": ["id"],
  };
  const allowed = options[`${family}.${action}`];
  if (!allowed) throw new CliError(2, "BLK-CLI-002", "命令不存在。");
  allow(args, ["json", ...allowed], 4);
  for (const key of allowed) required(args, key);
  let project = await readProject(args.words[3]);
  if (action === "list") {
    const data =
      family === "settings"
        ? {
            settings: settingDefinitions.map((def) => ({
              ...def,
              resolved: resolveSetting(def.id, {
                project: project.settings
                  ? parseSettings(project.settings)
                  : createSettings("project"),
              }),
            })),
          }
        : {
            definitions: resourceDefinitions,
            resources: Object.values(project.resources),
          };
    return { code: 0, result: envelope(command, data) };
  }
  if (action === "references")
    return {
      code: 0,
      result: envelope(command, {
        references: analyzeResourceReferences(project, required(args, "id")),
      }),
    };
  try {
    if (family === "module") {
      const id = required(args, "id");
      if (action === "create")
        createModule(project, id, required(args, "name"));
      if (action === "rename")
        renameModule(project, id, required(args, "name"));
      if (action === "delete") deleteModule(project, id);
    } else if (family === "settings") {
      const settings = project.settings
        ? parseSettings(project.settings)
        : createSettings("project");
      const next =
        action === "reset"
          ? resetSetting(settings, required(args, "id"))
          : updateSetting(
              settings,
              required(args, "id"),
              JSON.parse(required(args, "value")),
            );
      project.settings = { ...next, scope: "project" };
      project.manifest.settingsRef = "settings.json";
    } else if (action === "set") {
      const bytes = await readFile(required(args, "definition"));
      if (bytes.length > 1024 * 1024) throw Error();
      project = upsertProjectResource(
        project,
        JSON.parse(bytes.toString("utf8")),
      );
    } else project = removeProjectResource(project, required(args, "id"));
  } catch {
    throw new CliError(
      3,
      "BLK-CONFIG-001",
      "输入的模块、设置或资源定义无效；原项目未改变。",
    );
  }
  const compiled = await compileProject(project);
  await createProject(required(args, "output"), project);
  const result = envelope(command, {
    digest: await projectDigest(project),
    diagnostics: compiled.diagnostics,
  });
  if (compiled.diagnostics.some((d) => d.severity === "error"))
    result.warnings.push("已保存新文件，引用问题需在运行前修复。");
  return { code: 0, result };
}
