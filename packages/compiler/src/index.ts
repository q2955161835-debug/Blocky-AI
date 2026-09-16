import {
  diagnostic,
  type Project,
  type Diagnostic,
  type ProjectIR,
  type ModuleIR,
  type InteractionManifest,
  type ToolContract,
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
export async function compileProject(input: Project): Promise<Compilation> {
  const p = parseProject(input);
  const compiled = p.manifest.modules.map((m) =>
    compileWorkspace(p.manifest.projectId, m, p.workspaces[m.moduleId]),
  );
  const modules = compiled.map((c) => c.ir);
  const diagnostics = compiled.flatMap((c) => c.diagnostics);
  const linked = await linkProject(p, modules);
  const projected = projectInteraction(p, modules);
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
