import {
  catalog,
  catalogVersion,
  getBlock,
  createStartingBlueprint,
} from "@blocky/block-catalog";
import { compileProject } from "@blocky/compiler";
import { runAgent, type RunAgentContext } from "./run-agent";
import { projectDigest, createEmptyProject, applyDefaultModel } from "@blocky/project-model";
import { startingBlueprintCommand, startingBlueprintHelp } from "./starting-blueprints";
import { digest } from "@blocky/language-schema";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { type Args, allow, required, integer } from "./arguments";
import { envelope, CliError } from "./protocol";
import {
  createProject,
  readProject,
  doctor,
  nativeUserOperation,
} from "./native-store";
import { configure } from "./configure";
import { construction, constructionHelp } from "./construction";
import { builderCommand, builderHelp } from "./builder";
import { codingCommand, codingHelp } from "./coding";
import { builderWorkCommand, builderWorkHelp } from "./builder-work";
import { discoveryCommand, discoveryHelp } from "./discovery";
import { blockQueryCommand, blockQueryHelp } from "./block-query";
import { productivityCommand, productivityHelp } from "./productivity";
import { editorCommand, editorHelp } from "./editor";
import { rpaCommand, rpaHelp } from "./rpa";
import { workflowCommand, workflowHelp } from "./workflow";
import { traceCommand, traceHelp } from "./trace";
import { conversion, conversionHelp } from "./conversion";
import { taskCommand, taskHelp } from "./tasks";
import { exportDiagnostics } from "./diagnostics";
import { migrationCommand } from "./migration";
import { foundationsCommand, foundationsHelp } from "./foundations";
import { knowledgeCommand, knowledgeHelp } from "./knowledge";
import { modelCommand, modelHelp } from "./models";
import { modelProfilesCommand, modelProfilesHelp } from "./model-profiles";
import { toolCommand, toolHelp } from "./tools";
import { memoryCommand, memoryHelp } from "./memory";
import {skillCommand,skillHelp} from './skills';
import {nativeCapabilitiesCommand,nativeCapabilitiesHelp} from './native-capabilities';
import {evaluationWorkspaceCommand,evaluationWorkspaceHelp} from './evaluation-workspace';
import {triggerCommand,triggerHelp} from './triggers';
import {
  userConfigCommand,
  userConfigHelp,
  userRegistryMap,
  readDefaultModelId,
} from "./user-config";
export const help = {
  version: "0.8.0",
  commands: [
    ...startingBlueprintHelp,
    "profile show --json",
    ...discoveryHelp,
    ...blockQueryHelp,
    ...productivityHelp,
    ...editorHelp,
    ...rpaHelp,
    ...workflowHelp,
    ...traceHelp,
    ...knowledgeHelp,
    ...modelHelp,
    ...modelProfilesHelp,
    ...toolHelp,
    ...memoryHelp,
    ...skillHelp,
    ...nativeCapabilitiesHelp,
    ...evaluationWorkspaceHelp,
    ...triggerHelp,
    ...foundationsHelp,
    ...userConfigHelp,
    "project migrate <old.blocky> --output <new.blocky> --json",
    ...constructionHelp,
    ...builderHelp,
    ...codingHelp,
    ...builderWorkHelp,
    ...conversionHelp,
    ...taskHelp,
    "diagnostics export <logs.json> --output <diagnostics.json> [--channel <name>] [--project-id <id>] [--run-id <id>] [--module-id <id>] [--block-id <id>] [--correlation-id <id>] [--from <timestamp>] [--to <timestamp>] --json",
    "doctor --json",
    "catalog list [--limit 20] [--cursor 0] --json",
    "catalog show <block-id> --json",
    "project create [--template <knowledge-assistant|work-assistant|coding-assistant|pi-agent>] [--model <resource-id>] [--name <name>] --output <file.blocky> --json",
    "project inspect <file.blocky> --json",
    "project module list <file.blocky> --json",
    "project validate <file.blocky> --json",
    "project compile <file.blocky> --json",
    "project configure <file.blocky> --module <id> --block <id> --field <name> --value <text> --output <new.blocky> --json",
    "surface list <file.blocky> --json",
    "run preflight <file.blocky> --json",
    "run start <file.blocky> (--simulate | --live) (--input <question> | --inputs-file <strings.json>) [--workspace-dir <directory>] [--entry <id>] [--module <id>] [--from-block <id>] [--breakpoint <module:id[,module:id]> --debug-actions <actions.json>] [--trace-output <last-run.json>] [--rpa-inputs <module-inputs.json>] [--workflow-task <task-id>] [--timeout 120000] [--run-id <id>] [--interactive | --approval-file <sha256-array.json>] [--output <new-file>] --jsonl",
  ],
  modelApiCalled: false,
};
export async function dispatch(
  args: Args,
  write: (value: unknown) => void,
  signal: AbortSignal,
  context?: RunAgentContext,
) {
  const command = args.words.slice(0, 2).join(".");
  if (command === "profile.show") {
    allow(args, ["json"], 2);
    return {
      code: 0,
      result: envelope(command, {
        profile: await nativeUserOperation("profile-info", {}, signal),
      }),
    };
  }
  const discovered = discoveryCommand(args, help.commands);
  if (discovered) return discovered;
  const blueprint = await startingBlueprintCommand(args, signal);
  if (blueprint) return blueprint;
  const profiles = await modelProfilesCommand(args);
  if (profiles) return profiles;
  const model = await modelCommand(args, signal);
  if (model) return model;
  const tool = await toolCommand(args, signal);
  if (tool) return tool;
  const memory = await memoryCommand(args, signal);
  if (memory) return memory;
  const skill=await skillCommand(args,signal);if(skill)return skill;
  const capability=await nativeCapabilitiesCommand(args,signal);if(capability)return capability;
  const evaluation=await evaluationWorkspaceCommand(args,write,signal,context);if(evaluation)return evaluation;
  const trigger=await triggerCommand(args,write,signal);if(trigger)return trigger;
  const blocks = await blockQueryCommand(args);
  if (blocks) return blocks;
  const productivity = await productivityCommand(args, signal);
  if (productivity) return productivity;
  const editor = await editorCommand(args, signal);
  if (editor) return editor;
  const rpa = await rpaCommand(args, write, signal);
  if (rpa) return rpa;
  const workflow = await workflowCommand(args, signal);
  if (workflow) return workflow;
  const trace = await traceCommand(args);
  if (trace) return trace;
  const workResult = await builderWorkCommand(args, signal);
  if (workResult) return workResult;
  const codingResult = await codingCommand(args, signal);
  if (codingResult) return codingResult;
  const builderResult = await builderCommand(args, signal);
  if (builderResult) return builderResult;
  const knowledge = await knowledgeCommand(args, signal);
  if (knowledge) return knowledge;
  if (
    args.options.has("help") ||
    (args.words.length === 0 && !args.options.size)
  ) {
    allow(args, ["help"], 0);
    return { code: 0, result: envelope("help", help) };
  }
  if (args.options.has("version")) {
    allow(args, ["version", "json"], 0);
    return {
      code: 0,
      result: envelope("version", {
        cli: "0.8.0",
        core: "0.8.0",
        projectSchema: "blocky.project/v1",
        skills: null,
      }),
    };
  }
  if (args.options.has("live") && command !== "run.start")
    throw new CliError(
      4,
      "BLK-PERM-001",
      "仅 run start 支持 live 运行。",
      "使用 run start --live，并按预检摘要批准请求。",
    );
  if (command === "doctor") {
    allow(args, ["json"], 1);
    return {
      code: 0,
      result: envelope(command, {
        cli: "0.8.0",
        nativeStore: await doctor(),
        runtime: "deterministic",
        modelApiCalled: false,
      }),
    };
  }
  if (command === "catalog.list") {
    allow(args, ["json", "limit", "cursor"], 2);
    const limit = integer(args, "limit", 20, 100);
    const cursor = args.options.get("cursor") ?? "0";
    if (
      typeof cursor !== "string" ||
      !/^\d+$/.test(cursor) ||
      Number(cursor) > catalog.length
    )
      throw new CliError(2, "BLK-CLI-002", "目录分页游标无效。");
    const start = Number(cursor);
    const result = envelope(command, {
      catalogVersion,
      blocks: catalog.slice(start, start + limit),
    });
    result.nextCursor =
      start + limit < catalog.length ? String(start + limit) : null;
    return { code: 0, result };
  }
  if (command === "catalog.show") {
    allow(args, ["json"], 3);
    const block = getBlock(args.words[2]);
    if (!block) throw new CliError(3, "BLK-CATALOG-001", "积木不存在。");
    return { code: 0, result: envelope(command, { catalogVersion, block }) };
  }
  if (command === "project.create") {
    allow(args, ["json", "name", "output", "template", "model"], 2);
    const output = required(args, "output");
    let project;
    try {
      project = args.options.has("template") ? createStartingBlueprint(required(args, "template")) : createEmptyProject(args.options.has("name") ? required(args, "name") : undefined);
      if (args.options.has("name")) {
        const name=required(args,"name").trim(); if (!name || name.length>200) throw Error("BLK-PROJECT-NAME-001"); project.manifest.displayName=name;
      }
    } catch {
      throw new CliError(2, "BLK-CLI-002", "项目名称无效或起始蓝图不存在。", "template list 可查看当前四个起点。");
    }
    if (args.options.has("model") && !args.options.has("template")) throw new CliError(2,"BLK-CLI-002","空白项目没有模型积木，请先选择起始蓝图或自行添加积木。");
    if (args.options.has("template")) {
      const modelId=args.options.has("model")?required(args,"model"):await readDefaultModelId();
      if (modelId) {
        try { project=applyDefaultModel(project,modelId,await userRegistryMap()); }
        catch { if(args.options.has("model")) throw new CliError(3,"BLK-MODEL-DEFAULT-001","指定模型未配置或不可用。","使用 resource list 查看本机模型。"); }
      }
    }
    await createProject(output, project);
    const bytes = await readFile(output);
    const result = envelope(command, {
      projectId: project.manifest.projectId,
      digest: await projectDigest(project),
      modelApiCalled: false,
    });
    result.artifacts = [
      {
        path: basename(output),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ];
    return { code: 0, result };
  }
  const moduleList = args.words.slice(0, 3).join(".") === "project.module.list";
  const userConfig = await userConfigCommand(args);
  if (userConfig) return userConfig;
  const foundation = await foundationsCommand(args);
  if (foundation) return foundation;
  const migrated = await migrationCommand(args);
  if (migrated) return migrated;
  const exported = await exportDiagnostics(args);
  if (exported) return exported;
  const converted = await conversion(args, signal);
  if (converted) return converted;
  const constructed = await construction(args, signal);
  const task = await taskCommand(args, signal);
  if (task) return task;
  if (constructed) return constructed;
  if (command === "project.configure") return configure(args);
  const known = [
    "project.inspect",
    "project.validate",
    "project.compile",
    "run.preflight",
    "run.start",
    "surface.list",
  ];
  if (!known.includes(command) && !moduleList)
    throw new CliError(2, "BLK-CLI-002", "命令尚未实现或不存在。");
  allow(
    args,
    command === "run.start"
      ? [
          "simulate",
          "live",
          "jsonl",
          "input",
          "entry",
          "module",
          "timeout",
          "run-id",
          "approval-file",
          "interactive",
          "output",
          "from-block",
          "breakpoint",
          "debug-actions",
          "trace-output",
          "inputs-file",
          "rpa-inputs",
          "workflow-task",
          "workspace-dir",
        ]
      : ["json"],
    moduleList ? 4 : 3,
  );
  if (
    command === "run.start" &&
    (args.options.has("simulate") === args.options.has("live") ||
      !args.options.has("jsonl"))
  )
    throw new CliError(
      2,
      "BLK-CLI-002",
      "运行必须选择 --simulate 或 --live，并使用 --jsonl。",
    );
  const project = await readProject(args.words[moduleList ? 3 : 2]);
  const userRegistry = project.manifest.resources.some(
    (r) => r.scope === "user",
  )
    ? await userRegistryMap()
    : undefined;
  const compiled = await compileProject(project, userRegistry);
  const modelApiCalled = false;
  if (moduleList)
    return {
      code: 0,
      result: envelope("project.module.list", {
        modules: project.manifest.modules,
        links: compiled.ir.links,
        diagnostics: compiled.diagnostics,
      }),
    };
  if (command === "surface.list")
    return {
      code: 0,
      result: envelope(command, { surfaces: project.manifest.appSurfaces }),
    };
  if (command === "project.inspect")
    return {
      code: 0,
      result: envelope(command, {
        projectId: project.manifest.projectId,
        displayName: project.manifest.displayName,
        digest: await projectDigest(project),
        modules: project.manifest.modules,
        resources: project.manifest.resources.map((r) => ({
          resourceId: r.resourceId,
          kind: r.kind,
          scope: r.scope,
        })),
        surfaces: project.manifest.appSurfaces,
        diagnostics: compiled.diagnostics,
        modelApiCalled,
      }),
    };
  const invalid = compiled.diagnostics.some((d) => d.severity === "error");
  if (command === "project.validate") {
    const result = envelope(command, {
      valid: !invalid,
      diagnostics: compiled.diagnostics,
      projectDigest: await projectDigest(project),
    });
    result.ok = !invalid;
    return { code: invalid ? 3 : 0, result };
  }
  if (command === "project.compile") {
    const result = envelope(command, {
      modules: compiled.modules,
      project: compiled.ir,
      interaction: compiled.interaction,
      tools: compiled.tools,
      diagnostics: compiled.diagnostics,
      digest: await digest(compiled.ir),
    });
    result.ok = !invalid;
    return { code: invalid ? 3 : 0, result };
  }
  if (command === "run.preflight") {
    const result = envelope(command, {
      ready: !invalid && compiled.interaction.entries.length > 0,
      entries: compiled.interaction.entries,
      permissions: compiled.tools.flatMap((t) => t.permissions),
      diagnostics: compiled.diagnostics,
      mode: "simulate",
      modelApiCalled,
    });
    result.ok = !invalid && compiled.interaction.entries.length > 0;
    return { code: result.ok ? 0 : 3, result };
  }
  if (invalid)
    throw new CliError(
      3,
      "BLK-COMPILE-001",
      "项目存在编译错误，未执行运行。",
      "使用 project validate 查看结构化诊断。",
    );
  return runAgent(
    args,
    project,
    compiled.interaction.entries,
    userRegistry,
    write,
    signal,
    context,
  );
}
