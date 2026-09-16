import {
  canonicalJson,
  diagnostic,
  type Diagnostic,
  type IrNode,
  type Project,
  type WorkspaceBlock,
} from "@blocky/language-schema";
import { parseProject } from "@blocky/project-model";
import { compileProject } from "@blocky/compiler";
const supported = new Set([
  "core.agent.define",
  "core.interaction.chat_entry",
  "core.interaction.accept_text",
  "core.message.reply",
  "core.message.create",
  "core.data.literal",
]);
/** This is a source-format adapter, not a legacy runtime. Only language atoms
 * whose semantics have a current implementation can cross this boundary. */
export async function migrateSpike(
  files: Record<string, string>,
): Promise<{ project?: Project; diagnostics: Diagnostic[] }> {
  const envelope = JSON.parse(files["manifest.json"] ?? "null");
  if (
    Object.keys(files).length !== 2 ||
    canonicalJson(envelope) !==
      canonicalJson({ formatVersion: "blocky.document/v1" })
  )
    throw Error("BLK-MIG-001");
  const old = JSON.parse(files["project.json"]);
  if (
    old.schemaVersion !== "blocky.spike-project/v1" ||
    Object.keys(old).some(
      (k) =>
        ![
          "schemaVersion",
          "projectId",
          "workspace",
          "program",
          "interactionManifest",
        ].includes(k),
    )
  )
    throw Error("BLK-MIG-001");
  const project = parseProject({
    manifest: {
      schemaVersion: "blocky.project/v1",
      projectId: old.projectId,
      displayName: old.projectId,
      modules: [
        {
          moduleId: "main",
          displayName: "主画布",
          purpose: "general",
          workspaceRef: "workspaces/main.workspace.json",
          exports: [],
        },
      ],
      resources: [],
      appSurfaces: [],
      format: {
        createdWith: "blocky-migration/0.2.0",
        minimumReaderVersion: "0.2.0",
      },
    },
    workspaces: { main: old.workspace },
    resources: {},
    schemas: {},
    surfaces: {},
  });
  const diagnostics: Diagnostic[] = [];
  const visit = (node: WorkspaceBlock) => {
    const source = {
      projectId: old.projectId,
      moduleId: "main",
      blockId: node.id,
    };
    if (!supported.has(node.type))
      diagnostics.push(
        diagnostic(
          "BLK-MIG-002",
          `尚不能等价迁移积木 ${node.type}，原积木保留在源文件。`,
          source,
        ),
      );
    if (
      node.disabled !== undefined ||
      Object.values(node.inputs ?? {}).some((i) => i.shadow)
    )
      diagnostics.push(
        diagnostic(
          "BLK-MIG-003",
          "旧格式禁用/影子状态不能静默改变语义。",
          source,
        ),
      );
    Object.values(node.inputs ?? {}).forEach((i) => i.block && visit(i.block));
    if (node.next) visit(node.next.block);
  };
  project.workspaces.main.blocks.blocks.forEach(visit);
  if (diagnostics.length) return { diagnostics };
  const compiled = await compileProject(project);
  if (compiled.diagnostics.length) return { diagnostics: compiled.diagnostics };
  const oldNode = (n: IrNode): unknown => ({
    id: n.nodeId,
    type: n.blockType,
    fields: n.fields,
    inputs: Object.fromEntries(
      Object.entries(n.inputs).map(([k, v]) => [
        k,
        v && !Array.isArray(v) ? oldNode(v) : null,
      ]),
    ),
    next: n.next ? oldNode(n.next) : null,
  });
  const expectedProgram = {
    schemaVersion: "blocky.ir/v0-spike",
    roots: [...compiled.modules[0].roots]
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
      .map(oldNode),
  };
  const expectedManifest = {
    schemaVersion: "blocky.interaction/v0-spike",
    entries: compiled.interaction.entries.map((e) => ({
      id: e.interactionId,
      ownerAgentId: e.ownerAgentId,
      displayName: e.displayName,
      acceptedParts: e.acceptedParts,
      exposedSkills: [],
      exposedPluginActions: [],
      executionRequirements: [],
    })),
  };
  if (
    canonicalJson(old.program) !== canonicalJson(expectedProgram) ||
    canonicalJson(old.interactionManifest) !== canonicalJson(expectedManifest)
  )
    return {
      diagnostics: [
        diagnostic(
          "BLK-MIG-004",
          "旧项目派生数据与画布不一致，未生成迁移作品。",
          { projectId: old.projectId, moduleId: "main" },
        ),
      ],
    };
  return { project, diagnostics: [] };
}
