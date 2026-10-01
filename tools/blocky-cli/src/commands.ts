import {
  catalog,
  catalogVersion,
  getBlock,
  createAgentExample,
} from "@blocky/block-catalog";
import {
  officialStarters,
  capabilityStarters,
  createCapabilityStarter,
  architectureStarters,
  createArchitectureStarter,
  createBlueprintProject,
} from "@blocky/block-catalog";
import { compileProject } from "@blocky/compiler";
import { runAgent, type RunAgentContext } from "./run-agent";
import { projectDigest, applyDefaultModel } from "@blocky/project-model";
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
  defaultModelError,
} from "./user-config";
export const help = {
  version: "0.8.0",
  commands: [
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
    "template list --json",
    "template show research-companion --json",
    "project create --template research-companion --output <file.blocky> --json",
    "project inspect <file.blocky> --json",
    "project module list <file.blocky> --json",
    "project validate <file.blocky> --json",
    "project compile <file.blocky> --json",
    "project configure <file.blocky> --module <id> --block <id> --field <name> --value <text> --output <new.blocky> --json",
    "surface list <file.blocky> --json",
    "run preflight <file.blocky> --json",
    "run start <file.blocky> (--simulate | --live) (--input <question> | --inputs-file <strings.json>) [--entry <id>] [--module <id>] [--from-block <id>] [--breakpoint <module:id[,module:id]> --debug-actions <actions.json>] [--trace-output <last-run.json>] [--rpa-inputs <module-inputs.json>] [--workflow-task <task-id>] [--timeout 120000] [--run-id <id>] [--interactive | --approval-file <sha256-array.json>] [--output <new-file>] --jsonl",
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
  if (command === "template.list") {
    allow(args, ["json"], 2);
    return {
      code: 0,
      result: envelope(command, {
        templates: [
          ...officialStarters.map((s) => ({
            ...s,
            templateId: s.id,
            kind: "blueprint",
            compatibilityClaim: "none",
          })),
          ...[...capabilityStarters, ...architectureStarters].map((s) => ({
            ...s,
            templateId: s.id,
            kind: "project",
            compatibilityClaim: "none",
          })),
          {
            id: "agent-loop",
            templateId: "agent-loop",
            displayName: "文本分析 Agent",
            kind: "project",
            compatibilityClaim: "none",
          },
        ],
      }),
    };
  }
  if (command === "template.show") {
    allow(args, ["json"], 3);
    if (args.words[2] === "agent-loop")
      return {
        code: 0,
        result: envelope(command, {
          templateId: "agent-loop",
          kind: "project",
          displayName: "文本分析 Agent",
          sampleInput: "Hello Blocky",
          compatibilityClaim: "none",
        }),
      };
    const selected = [
      ...officialStarters,
      ...architectureStarters,
      ...capabilityStarters,
    ].find((s) => s.id === args.words[2]);
    if (!selected) throw new CliError(3, "BLK-CATALOG-001", "模板尚不可用。");
    return {
      code: 0,
      result: envelope(command, {
        ...selected,
        templateId: selected.id,
        kind: [...architectureStarters, ...capabilityStarters].some(
          (s) => s.id === selected.id,
        )
          ? "project"
          : "blueprint",
        compatibilityClaim: "none",
      }),
    };
  }
  if (command === "project.create") {
    allow(args, ["json", "template", "output"], 2);
    if (
      required(args, "template") !== "agent-loop" &&
      !capabilityStarters.some((s) => s.id === required(args, "template")) &&
      !architectureStarters.some((s) => s.id === required(args, "template")) &&
      !officialStarters.some((s) => s.id === required(args, "template"))
    )
      throw new CliError(3, "BLK-CATALOG-001", "模板尚不可用。");
    const output = required(args, "output"),
      starter =
        required(args, "template") === "agent-loop"
          ? createAgentExample()
          : capabilityStarters.some((s) => s.id === required(args, "template"))
            ? createCapabilityStarter(required(args, "template"))
            : architectureStarters.some(
                  (s) => s.id === required(args, "template"),
                )
              ? createArchitectureStarter(required(args, "template"))
              : await createBlueprintProject(required(args, "template"));
    let project;
    try {
      project = applyDefaultModel(
        starter,
        await readDefaultModelId(),
        await userRegistryMap(),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "BLK-MODEL-DEFAULT-001")
        throw defaultModelError();
      throw error;
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
