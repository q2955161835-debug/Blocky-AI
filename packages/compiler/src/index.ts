import {
  diagnostic,
  type Project,
  type Diagnostic,
  type ProjectIR,
  type ModuleIR,
  type InteractionManifest,
  type ToolContract,
  canonicalJson,
} from "@blocky/language-schema";
import { parseProject } from "@blocky/project-model";
import { compileWorkspace } from "./module";
import { linkProject } from "./link";
import { projectInteraction } from "./interaction";
export { compileWorkspace, linkProject, projectInteraction };
export { walkNodes } from "./nodes";
export type Compilation = {
  modules: ModuleIR[];
  ir: ProjectIR;
  interaction: InteractionManifest;
  tools: ToolContract[];
  diagnostics: Diagnostic[];
};
export async function compileProject(
  input: Project,
  userRegistry = new Map<string, import("@blocky/language-schema").Resource>(),
): Promise<Compilation> {
  const p = parseProject(input);
  const compiled = p.manifest.modules.map((m) =>
    compileWorkspace(p.manifest.projectId, m, p.workspaces[m.moduleId]),
  );
  return finishCompilation(p, compiled, userRegistry);
}
async function finishCompilation(
  p: Project,
  compiled: ReturnType<typeof compileWorkspace>[],
  userRegistry = new Map<string, import("@blocky/language-schema").Resource>(),
): Promise<Compilation> {
  const modules = compiled.map((c) => c.ir);
  const diagnostics = compiled.flatMap((c) => c.diagnostics);
  const linked = await linkProject(p, modules);
  const projected = projectInteraction(p, modules, userRegistry);
  diagnostics.push(...linked.diagnostics, ...projected.diagnostics);
  // A project with any compiler error has no executable links.
  if (diagnostics.some((d) => d.severity === "error")) linked.ir.links = [];
  const seen = new Set<string>();
  return {
    modules,
    ir: linked.ir,
    interaction: projected.interaction,
    tools: projected.tools,
    diagnostics: diagnostics.filter((d) => {
      const key = d.code + JSON.stringify(d.source);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

/** Cache only module-local compilation; linking/projections always see current global facts.
 * Snapshots own their data so neither callers nor concurrent renders can mutate the cache. */
export class IncrementalCompiler {
  private cache = new Map<
    string,
    {
      key: string;
      value: ReturnType<typeof compileWorkspace>;
    }
  >();
  stats: { compiled: string[]; reused: string[] } = {
    compiled: [],
    reused: [],
  };
  async compile(
    input: Project,
    userRegistry = new Map<
      string,
      import("@blocky/language-schema").Resource
    >(),
  ): Promise<Compilation> {
    const project = parseProject(input);
    const next = new Map<
      string,
      { key: string; value: ReturnType<typeof compileWorkspace> }
    >();
    const stats = { compiled: [] as string[], reused: [] as string[] };
    const compiled = project.manifest.modules.map((module) => {
      const key = canonicalJson([
        project.manifest.projectId,
        module,
        project.workspaces[module.moduleId],
      ]);
      const previous = this.cache.get(module.moduleId);
      const value =
        previous?.key === key
          ? previous.value
          : compileWorkspace(
              project.manifest.projectId,
              module,
              project.workspaces[module.moduleId],
            );
      (previous?.key === key ? stats.reused : stats.compiled).push(
        module.moduleId,
      );
      next.set(module.moduleId, { key, value: structuredClone(value) });
      return structuredClone(value);
    });
    this.cache = next;
    this.stats = stats;
    return finishCompilation(project, compiled, userRegistry);
  }
  clear() {
    this.cache.clear();
    this.stats = { compiled: [], reused: [] };
  }
}
