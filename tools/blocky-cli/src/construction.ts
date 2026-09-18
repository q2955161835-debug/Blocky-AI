import { userRegistryMap } from "./user-config";
import {
  captureBlueprint,
  parseBlueprint,
  instantiateBlueprint,
  defaultBindings,
  type BlueprintBindings,
} from "@blocky/block-catalog";
import { ProjectController, projectDigest } from "@blocky/project-model";
import {
  makePatch as makePatchDomain,
  previewPatch as previewPatchDomain,
  applyPatch as applyPatchDomain,
} from "@blocky/builder-protocol";
import { conversionCandidate as conversionCandidateDomain } from "@blocky/conversion-core";
import { draftSurface as draftSurfaceDomain } from "@blocky/app-surface";
import { readProject, applyProjectPatch, validatePatch } from "./native-store";
import { type Args, allow, required } from "./arguments";
import { envelope, CliError } from "./protocol";
import { artifactInfo, readJsonArtifact, writeJsonArtifact } from "./artifacts";
const operations = [
  "surface.create",
  "blueprint.create",
  "blueprint.show",
  "blueprint.insert",
  "patch.preview",
  "patch.apply",
  "conversion.scan",
];
export const constructionHelp = [
  "surface create <file.blocky> --module <id> --output <patch.json> --json",
  "blueprint create <file.blocky> --module <id> --blocks <id,id> --name <name> --output <blueprint.json> --json",
  "blueprint show <blueprint.json> --json",
  "blueprint insert <file.blocky> --blueprint <blueprint.json> --module <id> [--reuse-bindings | --bindings <bindings.json>] [--x 80] [--y 80] --output <new.blocky> --json",
  "conversion scan <file.blocky> --fixture haystack-bm25 --module <id> --resource <id> --output <candidate.json> --json",
  "patch preview <file.blocky> --patch <candidate-or-patch.json> --json",
  "patch apply <file.blocky> --patch <candidate-or-patch.json> [--approve-permissions <permission,permission>] --output <new.blocky> --json",
];
function coordinate(args: Args, key: string) {
  const raw = args.options.get(key),
    value = raw === undefined ? 80 : Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 100000)
    throw new CliError(2, "BLK-CLI-002", "画布坐标超出范围。");
  return value;
}
function unwrapPatch(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    "schemaVersion" in input &&
    ["blocky.conversion/v1alpha1", "blocky.conversion/v1"].includes(
      String(input.schemaVersion),
    ) &&
    "patch" in input
  )
    return input.patch;
  return input;
}
export async function construction(args: Args, signal: AbortSignal) {
  const command = args.words.slice(0, 2).join(".");
  if (!operations.includes(command)) return;
  try {
    signal.throwIfAborted();
    if (command === "blueprint.show") {
      allow(args, ["json"], 3);
      const blueprint = await parseBlueprint(
        await readJsonArtifact(args.words[2]),
      );
      return {
        code: 0,
        result: envelope(command, {
          blueprint,
          defaultBindings: defaultBindings(blueprint),
        }),
      };
    }
    const allowed: Record<string, string[]> = {
      "surface.create": ["module", "output", "json"],
      "blueprint.create": ["module", "blocks", "name", "output", "json"],
      "blueprint.insert": [
        "module",
        "blueprint",
        "bindings",
        "reuse-bindings",
        "x",
        "y",
        "output",
        "json",
      ],
      "conversion.scan": ["fixture", "module", "resource", "output", "json"],
      "patch.preview": ["patch", "json"],
      "patch.apply": ["patch", "approve-permissions", "output", "json"],
    };
    allow(args, allowed[command], 3);
    const project = await readProject(args.words[2]);
    const userRegistry = project.manifest.resources.some(
      (r) => r.scope === "user",
    )
      ? await userRegistryMap()
      : undefined;
    const makePatch = (
      project: Parameters<typeof makePatchDomain>[0],
      operations: Parameters<typeof makePatchDomain>[1],
    ) => makePatchDomain(project, operations, userRegistry);
    const previewPatch = (
      project: Parameters<typeof previewPatchDomain>[0],
      patch: unknown,
    ) => previewPatchDomain(project, patch, userRegistry);
    const applyPatch = (
      ...args: [
        Parameters<typeof applyPatchDomain>[0],
        unknown,
        string[],
        Parameters<typeof applyPatchDomain>[3]?,
      ]
    ) => applyPatchDomain(args[0], args[1], args[2], args[3], userRegistry);
    const draftSurface = (
      ...args: [
        Parameters<typeof draftSurfaceDomain>[0],
        string,
        Parameters<typeof draftSurfaceDomain>[2],
      ]
    ) => draftSurfaceDomain(...args, userRegistry);
    const conversionCandidate = (
      ...args: [
        Parameters<typeof conversionCandidateDomain>[0],
        string,
        string,
        AbortSignal?,
      ]
    ) =>
      conversionCandidateDomain(
        args[0],
        args[1],
        args[2],
        args[3],
        userRegistry,
      );

    if (command === "surface.create") {
      const draft = await draftSurface(
        project,
        required(args, "module"),
        "explicit-user-command",
      );
      const patch = await makePatch(project, [
        { op: "app-surface.add", ...draft },
      ]);
      signal.throwIfAborted();
      const result = envelope(command, { patch, modelApiCalled: false });
      result.artifacts = [
        await writeJsonArtifact(required(args, "output"), patch),
      ];
      return { code: 0, result };
    }
    if (command === "blueprint.create") {
      const blueprint = await captureBlueprint(
        project,
        required(args, "module"),
        required(args, "blocks").split(","),
        required(args, "name"),
      );
      signal.throwIfAborted();
      const result = envelope(command, {
        blueprintId: blueprint.blueprintId,
        digest: blueprint.digest,
        resources: blueprint.resources,
        modules: blueprint.modules,
      });
      result.artifacts = [
        await writeJsonArtifact(required(args, "output"), blueprint),
      ];
      return { code: 0, result };
    }
    if (command === "conversion.scan") {
      if (required(args, "fixture") !== "haystack-bm25")
        throw new CliError(
          3,
          "BLK-CONVERT-001",
          "当前只支持已锁定的本地快照。",
        );
      const candidate = await conversionCandidate(
        project,
        required(args, "module"),
        required(args, "resource"),
        signal,
      );
      signal.throwIfAborted();
      const result = envelope(command, candidate);
      result.artifacts = [
        await writeJsonArtifact(required(args, "output"), candidate),
      ];
      return { code: 0, result };
    }
    let patch: unknown;
    if (command === "blueprint.insert") {
      const blueprint = await parseBlueprint(
        await readJsonArtifact(required(args, "blueprint")),
      );
      if (args.options.has("bindings") && args.options.has("reuse-bindings"))
        throw new CliError(
          2,
          "BLK-CLI-002",
          "绑定文件与复用来源绑定选项不能同时使用。",
        );
      const input = args.options.has("bindings")
        ? await readJsonArtifact(required(args, "bindings"))
        : args.options.has("reuse-bindings")
          ? defaultBindings(blueprint)
          : { resources: {}, modules: {} };
      if (
        !input ||
        typeof input !== "object" ||
        !("resources" in input) ||
        !("modules" in input) ||
        !input.resources ||
        !input.modules ||
        typeof input.resources !== "object" ||
        typeof input.modules !== "object"
      )
        throw new CliError(3, "BLK-BLUEPRINT-002", "绑定文件结构无效。");
      const moduleId = required(args, "module");
      const roots = await instantiateBlueprint(
        blueprint,
        project,
        moduleId,
        input as BlueprintBindings,
        { x: coordinate(args, "x"), y: coordinate(args, "y") },
      );
      patch = await makePatch(
        project,
        roots.map((root) => ({
          op: "block.add",
          moduleId,
          blockId: root.id,
          payload: root,
        })),
      );
    } else patch = unwrapPatch(await readJsonArtifact(required(args, "patch")));
    const preview = await previewPatch(project, patch);
    if (command === "patch.preview")
      return {
        code: 0,
        result: envelope(command, {
          patch: preview.patch,
          changes: preview.changes,
          permissionDelta: preview.permissionDelta,
          diagnostics: preview.diagnostics,
          nextDigest: await projectDigest(preview.next),
        }),
      };
    const controller = new ProjectController(project);
    const approvals =
      typeof args.options.get("approve-permissions") === "string"
        ? String(args.options.get("approve-permissions")).split(",")
        : [];
    await applyPatch(controller, patch, approvals, validatePatch);
    signal.throwIfAborted();
    const output = required(args, "output");
    await applyProjectPatch(args.words[2], output, project, patch, approvals);
    const result = envelope(command, {
      digest: await projectDigest(controller.getSnapshot().project),
      changes: preview.changes,
      diagnostics: preview.diagnostics,
      modelApiCalled: false,
    });
    result.artifacts = [await artifactInfo(output)];
    return { code: 0, result };
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (signal.aborted) throw new CliError(7, "BLK-RUN-005", "操作已取消。");
    if (
      error instanceof Error &&
      /^BLK-(?:BLUEPRINT|PATCH|CONVERT|SURFACE)-\d{3}$/.test(error.message)
    )
      throw new CliError(
        error.message === "BLK-PATCH-001" ? 5 : 3,
        error.message,
        "工件、绑定或基线校验失败，原项目未修改。",
        "检查工件和绑定，重新生成预览；新增权限需单独批准。",
      );
    throw error;
  }
}
