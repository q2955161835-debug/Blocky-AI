import {
  diagnostic,
  digest,
  canonicalJson,
  type Project,
  type ModuleIR,
  type IrNode,
  type WorkspaceBlock,
  type Diagnostic,
  type SourceRef,
  type ProjectIR,
  type ProjectLink,
  type InteractionManifest,
  type ToolContract,
} from "@blocky/language-schema";
import { parseProject } from "@blocky/project-model";
import { getBlock } from "@blocky/block-catalog";
export type Compilation = {
  modules: ModuleIR[];
  ir: ProjectIR;
  interaction: InteractionManifest;
  tools: ToolContract[];
  diagnostics: Diagnostic[];
};
export async function compileProject(input: Project): Promise<Compilation> {
  const p = parseProject(input);
  const diagnostics: Diagnostic[] = [];
  const links: ProjectLink[] = [];
  const tools: ToolContract[] = [];
  const interaction: InteractionManifest = {
    schemaVersion: "blocky.interaction/v1alpha1",
    projectId: p.manifest.projectId,
    entries: [],
  };
  const modules = p.manifest.modules.map((module) => {
    const sources: Record<string, SourceRef> = {};
    const ids = new Set<string>();
    const compile = (b: WorkspaceBlock, owner?: string): IrNode => {
      const source = {
        projectId: p.manifest.projectId,
        moduleId: module.moduleId,
        blockId: b.id,
      };
      if (ids.has(b.id))
        diagnostics.push(diagnostic("BLK-TYPE-002", "积木 ID 重复", source));
      ids.add(b.id);
      sources[b.id] = source;
      const def = getBlock(b.type);
      if (!def)
        diagnostics.push(diagnostic("BLK-TYPE-004", "未注册积木", source));
      const fields = b.fields ?? {};
      if (def)
        for (const name of def.fields)
          if (typeof fields[name] !== "string" || !fields[name])
            diagnostics.push(
              diagnostic("BLK-TYPE-005", `请填写 ${name}`, source),
            );
      if (b.type === "core.agent") owner = b.id;
      if (b.type === "core.interaction.chat") {
        if (!owner)
          diagnostics.push(
            diagnostic("BLK-TYPE-006", "聊天入口必须属于智能体", source),
          );
        else
          interaction.entries.push({
            interactionId: b.id,
            moduleId: module.moduleId,
            ownerAgentId: owner,
            displayName: String(fields.NAME),
            acceptedParts: ["text"],
            exposedSkills: [],
            exposedActions: [],
            executionRequirements: [],
          });
      }
      if (b.type === "core.module.call")
        links.push({
          linkId: `link-${module.moduleId}-${b.id}`,
          source: { ...source, portId: "call" },
          target: {
            moduleId: String(fields.MODULE),
            exportId: String(fields.EXPORT),
          },
          mode: "sync",
          timeoutMs: 5000,
        });
      if (
        b.type === "core.knowledge.retrieve" ||
        b.type === "core.model.compose"
      ) {
        const r = p.resources[String(fields.RESOURCE)];
        const kind =
          b.type === "core.knowledge.retrieve" ? "knowledge" : "model";
        if (!r || r.kind !== kind)
          diagnostics.push(
            diagnostic("BLK-RESOURCE-001", "资源不存在或类型不匹配", source),
          );
        else if (kind === "knowledge")
          tools.push({
            schemaVersion: "blocky.tool/v1alpha1",
            toolId: `tool-${module.moduleId}-${b.id}`,
            moduleId: module.moduleId,
            displayName: r.displayName,
            description: "检索带来源的资料",
            inputSchemaRef: "schemas/query.json",
            outputSchemaRef: "schemas/citations.json",
            permissions: r.capabilityRequirements,
            approval: "never",
            implementationRef: String(r.definition.implementationRef),
          });
      }
      const inputs: IrNode["inputs"] = {};
      for (const [name, value] of Object.entries(b.inputs ?? {})) {
        if (def && !def.inputs.includes(name))
          diagnostics.push(diagnostic("BLK-TYPE-007", "未知积木插槽", source));
        const child = value.block ?? value.shadow;
        inputs[name] = child ? compile(child, owner) : null;
      }
      return {
        nodeId: b.id,
        blockType: b.type,
        fields,
        inputs,
        ...(b.next ? { next: compile(b.next.block, owner) } : {}),
      };
    };
    return {
      schemaVersion: "blocky.module-ir/v1alpha1" as const,
      projectId: p.manifest.projectId,
      moduleId: module.moduleId,
      roots: p.workspaces[module.moduleId].blocks.blocks
        .filter((b) => !b.disabled)
        .map((b) => compile(b)),
      exports: module.exports,
      sourceMap: sources,
    };
  });
  const findNode = (nodes: IrNode[], id: string): IrNode | undefined => {
    for (const n of nodes) {
      if (n.nodeId === id) return n;
      const children = Object.values(n.inputs).flatMap((x) =>
        x ? (Array.isArray(x) ? x : [x]) : [],
      );
      if (n.next) children.push(n.next);
      const v = findNode(children, id);
      if (v) return v;
    }
    return undefined;
  };
  const validLinks: ProjectLink[] = [];
  for (const l of links) {
    const target = p.manifest.modules.find(
      (m) => m.moduleId === l.target.moduleId,
    );
    if (!target) {
      diagnostics.push(diagnostic("BLK-LINK-001", "目标模块不存在", l.source));
      continue;
    }
    const exp = target.exports.find((e) => e.exportId === l.target.exportId);
    if (!exp) {
      diagnostics.push(diagnostic("BLK-LINK-002", "目标导出不存在", l.source));
      continue;
    }
    const node = findNode(
      modules.find((m) => m.moduleId === l.source.moduleId)!.roots,
      l.source.blockId!,
    )!;
    const compatible = (a: unknown, b: string | undefined) =>
      typeof a === "string" &&
      !!b &&
      Object.hasOwn(p.schemas, a) &&
      Object.hasOwn(p.schemas, b) &&
      canonicalJson(p.schemas[a]) === canonicalJson(p.schemas[b]);
    if (
      !compatible(node.fields.INPUT, exp.inputSchemaRef) ||
      !compatible(node.fields.OUTPUT, exp.outputSchemaRef)
    ) {
      diagnostics.push(
        diagnostic("BLK-LINK-004", "调用输入输出与目标导出不兼容", l.source),
      );
      continue;
    }
    validLinks.push(l);
  }
  const cycleLinks = new Set<ProjectLink>();
  const visit = (moduleId: string, path: string[], edges: ProjectLink[]) => {
    for (const l of validLinks.filter((x) => x.source.moduleId === moduleId)) {
      const i = path.indexOf(l.target.moduleId);
      if (i >= 0) {
        [...edges.slice(i), l].forEach((x) => cycleLinks.add(x));
        continue;
      }
      visit(l.target.moduleId, [...path, l.target.moduleId], [...edges, l]);
    }
  };
  for (const m of modules) visit(m.moduleId, [m.moduleId], []);
  if (cycleLinks.size) {
    const refs = [...cycleLinks].map((l) => l.source);
    diagnostics.push(
      diagnostic("BLK-LINK-003", "同步模块调用不能形成环", refs[0], refs),
    );
  }
  const ir: ProjectIR = {
    schemaVersion: "blocky.project-ir/v1alpha1",
    projectId: p.manifest.projectId,
    modules: await Promise.all(
      modules.map(async (m) => ({
        moduleId: m.moduleId,
        digest: await digest({
          ...m,
          exports: m.exports.map(({ displayName, ...rest }) => rest),
        }),
      })),
    ),
    links,
  };
  return { modules, ir, interaction, tools, diagnostics };
}
