import { catalog, catalogVersion, getBlock } from "@blocky/block-catalog";
import { compileProject } from "@blocky/compiler";
import { Runtime } from "@blocky/runtime-core";
import { projectDigest } from "@blocky/project-model";
import { createStarter } from "@blocky/test-fixtures";
import { digest } from "@blocky/language-schema";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { type Args, allow, required, integer } from "./arguments";
import { envelope, CliError } from "./protocol";
import { createProject, readProject, doctor } from "./native-store";
import { configure } from "./configure";
import { construction, constructionHelp } from "./construction";
import { taskCommand, taskHelp } from "./tasks";
import { exportDiagnostics } from "./diagnostics";
import { migrationCommand } from "./migration";
import { foundationsCommand, foundationsHelp } from "./foundations";
import {
  userConfigCommand,
  userConfigHelp,
  userRegistryMap,
} from "./user-config";
export const help = {
  version: "0.2.0",
  commands: [
    ...foundationsHelp,
    ...userConfigHelp,
    "project migrate <old.blocky> --output <new.blocky> --json",
    ...constructionHelp,
    ...taskHelp,
    "diagnostics export <logs.json> --output <diagnostics.json> [--channel <name>] --json",
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
    "run start <file.blocky> --simulate --input <question> [--entry <id>] [--module <id>] [--timeout 30000] --jsonl",
  ],
  modelApiCalled: false,
};
const template = {
  templateId: "research-companion",
  displayName: "资料问答伙伴",
  kind: "blueprint",
  moduleCount: 2,
  requires: ["deterministic.knowledge", "deterministic.composer"],
  compatibilityClaim: "none",
};
export async function dispatch(
  args: Args,
  write: (value: unknown) => void,
  signal: AbortSignal,
) {
  const command = args.words.slice(0, 2).join(".");
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
        cli: "0.2.0",
        core: "0.2.0",
        projectSchema: "blocky.project/v1",
        skills: null,
      }),
    };
  }
  if (args.options.has("live"))
    throw new CliError(
      4,
      "BLK-PERM-001",
      "当前 CLI 不支持 live 运行。",
      "使用 --simulate 运行确定性本地适配器。",
    );
  if (command === "doctor") {
    allow(args, ["json"], 1);
    return {
      code: 0,
      result: envelope(command, {
        cli: "0.2.0",
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
    return { code: 0, result: envelope(command, { templates: [template] }) };
  }
  if (command === "template.show") {
    allow(args, ["json"], 3);
    if (args.words[2] !== template.templateId)
      throw new CliError(3, "BLK-CATALOG-001", "模板尚不可用。");
    return { code: 0, result: envelope(command, template) };
  }
  if (command === "project.create") {
    allow(args, ["json", "template", "output"], 2);
    if (required(args, "template") !== template.templateId)
      throw new CliError(3, "BLK-CATALOG-001", "模板尚不可用。");
    const output = required(args, "output"),
      project = createStarter();
    project.manifest.projectId = `project-${crypto.randomUUID()}`;
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
      ? ["simulate", "jsonl", "input", "entry", "module", "timeout"]
      : ["json"],
    moduleList ? 4 : 3,
  );
  if (
    command === "run.start" &&
    (!args.options.has("simulate") || !args.options.has("jsonl"))
  )
    throw new CliError(
      2,
      "BLK-CLI-002",
      "运行必须显式使用 --simulate --jsonl。",
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
  const question = required(args, "input");
  if (new TextEncoder().encode(question).length > 16000)
    throw new CliError(2, "BLK-CLI-002", "问题输入超过 16000 字节。");
  const moduleId = args.options.get("module");
  const candidates = compiled.interaction.entries.filter(
    (e) => moduleId === undefined || e.moduleId === moduleId,
  );
  const requested = args.options.get("entry");
  const matches =
    requested === undefined
      ? candidates.slice(0, 1)
      : candidates.filter((e) => e.interactionId === requested);
  if (matches.length !== 1)
    throw new CliError(
      3,
      "BLK-RUN-001",
      "交互入口不存在或不唯一。",
      "使用 run preflight 查找入口，并用 --module 指定画布。",
    );
  const entry = matches[0];
  const abort = new AbortController(),
    cancel = () => abort.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) abort.abort();
  const timeout = setTimeout(cancel, integer(args, "timeout", 30000, 300000));
  try {
    const runtime = new Runtime({ delayMs: 1 });
    const result = await runtime.run(project, entry.interactionId, question, {
      moduleId: entry.moduleId,
      userRegistry,
      signal: abort.signal,
      onEvent: write,
    });
    const response = envelope(command, {
      status: result.status,
      answer: result.answer,
      citations: result.citations,
      eventCount: result.events.length,
      modelApiCalled,
    });
    response.ok = result.status === "completed";
    return {
      code:
        result.status === "completed"
          ? 0
          : result.status === "cancelled"
            ? 7
            : 3,
      result: response,
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
