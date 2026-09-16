import {
  canonicalJson,
  diagnostic,
  digest,
  stableId,
  validRef,
  type Project,
  type ModuleIR,
  type ProjectLink,
  type ProjectIR,
  type Diagnostic,
} from "@blocky/language-schema";
import { walkNodes } from "./nodes";
export async function linkProject(
  project: Project,
  modules: ModuleIR[],
): Promise<{ ir: ProjectIR; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [],
    links: ProjectLink[] = [];
  for (const m of modules)
    for (const { node } of walkNodes(m.roots))
      if (node.blockType === "core.module.call") {
        const source = { ...m.sourceMap[node.nodeId], portId: "call" };
        if (
          ![node.fields.MODULE, node.fields.EXPORT].every(
            (v) => typeof v === "string" && stableId.test(v),
          )
        ) {
          diagnostics.push(diagnostic("BLK-TYPE-008", "引用标识无效", source));
          continue;
        }
        if (
          ![node.fields.INPUT, node.fields.OUTPUT].every(
            (v) => typeof v === "string" && validRef(v),
          )
        ) {
          diagnostics.push(
            diagnostic("BLK-REF-001", "Schema 引用无效", source),
          );
          continue;
        }
        const target = modules.find((t) => t.moduleId === node.fields.MODULE);
        if (!target) {
          diagnostics.push(
            diagnostic("BLK-LINK-001", "目标模块不存在", source),
          );
          continue;
        }
        const exp = target.exports.find(
          (e) => e.exportId === node.fields.EXPORT,
        );
        const entry = target.roots.find(
          (n) =>
            n.blockType === "core.tool.entry" &&
            n.fields.EXPORT === node.fields.EXPORT,
        );
        const agent = target.roots.filter((n) => n.blockType === "core.agent");
        if (
          !exp ||
          (exp.kind === "tool" && !entry) ||
          (exp.kind === "agent" && agent.length !== 1)
        ) {
          diagnostics.push(
            diagnostic("BLK-LINK-002", "目标导出不存在或缺少实现入口", source),
          );
          continue;
        }
        const compatible = (a: unknown, b: string | undefined) =>
          typeof a === "string" &&
          !!b &&
          Object.hasOwn(project.schemas, a) &&
          Object.hasOwn(project.schemas, b) &&
          canonicalJson(project.schemas[a]) ===
            canonicalJson(project.schemas[b]);
        if (
          !compatible(node.fields.INPUT, exp.inputSchemaRef) ||
          !compatible(node.fields.OUTPUT, exp.outputSchemaRef)
        ) {
          diagnostics.push(
            diagnostic("BLK-LINK-004", "调用输入输出与目标导出不兼容", source),
          );
          continue;
        }
        links.push({
          linkId: `link-${m.moduleId}-${node.nodeId}`,
          source,
          target: { moduleId: target.moduleId, exportId: exp.exportId },
          mode: "sync",
          timeoutMs: 5000,
        });
      }
  // DFS with visitation states avoids exponential traversal of shared subgraphs.
  const state = new Map<string, number>(),
    cycle = new Set<ProjectLink>();
  const visit = (moduleId: string, path: string[], edges: ProjectLink[]) => {
    state.set(moduleId, 1);
    for (const link of links.filter((l) => l.source.moduleId === moduleId)) {
      const t = link.target.moduleId;
      if (state.get(t) === 1) {
        const start = path.indexOf(t);
        [...edges.slice(start), link].forEach((l) => cycle.add(l));
      } else if (!state.has(t)) visit(t, [...path, t], [...edges, link]);
    }
    state.set(moduleId, 2);
  };
  modules.forEach((m) => {
    if (!state.has(m.moduleId)) visit(m.moduleId, [m.moduleId], []);
  });
  if (cycle.size) {
    const related = [...cycle].map((l) => l.source);
    diagnostics.push(
      diagnostic("BLK-LINK-003", "同步模块调用不能形成环", related[0], related),
    );
  }
  const ir: ProjectIR = {
    schemaVersion: "blocky.project-ir/v1alpha1",
    projectId: project.manifest.projectId,
    modules: await Promise.all(
      modules.map(async (m) => ({
        moduleId: m.moduleId,
        digest: await digest({
          ...m,
          exports: m.exports.map(({ displayName, ...e }) => e),
        }),
      })),
    ),
    links: diagnostics.length ? [] : links,
  };
  return { ir, diagnostics };
}
