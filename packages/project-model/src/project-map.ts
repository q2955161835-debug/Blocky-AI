import type { Project, WorkspaceBlock } from "@blocky/language-schema";

export type ModuleMapEntry = {
  moduleId: string;
  displayName: string;
  purpose: string;
  outgoing: { blockId: string; targetModuleId: string; exportId: string; broken: boolean }[];
  incoming: { sourceModuleId: string; blockId: string }[];
};

/** A read-only view of references; it never changes project execution semantics. */
export function projectMap(project: Project): ModuleMapEntry[] {
  const modules: ModuleMapEntry[] = project.manifest.modules.map(({ moduleId, displayName, purpose }) => ({
    moduleId, displayName, purpose, outgoing: [], incoming: [],
  }));
  const byId = new Map(modules.map((module) => [module.moduleId, module]));
  for (const module of modules) {
    for (const root of project.workspaces[module.moduleId]?.blocks.blocks ?? [])
      walk(root, (block) => {
        if (block.type !== "core.module.call") return;
        const targetModuleId = String(block.fields?.MODULE ?? "");
        const exportId = String(block.fields?.EXPORT ?? "");
        const target = byId.get(targetModuleId);
        const broken = !target || !project.manifest.modules.find((item) =>
          item.moduleId === targetModuleId)?.exports.some((item) => item.exportId === exportId);
        module.outgoing.push({ blockId: block.id, targetModuleId, exportId, broken });
        target?.incoming.push({ sourceModuleId: module.moduleId, blockId: block.id });
      });
  }
  return modules;
}

export function affectedModules(project: Project, targetModuleId: string): string[] {
  const map = projectMap(project);
  if (!map.some((module) => module.moduleId === targetModuleId)) throw Error("BLK-MODULE-001");
  const result = new Set<string>();
  const queue = [targetModuleId];
  for (let index = 0; index < queue.length; index++) {
    const current = map.find((module) => module.moduleId === queue[index]);
    for (const source of current?.incoming ?? []) {
      if (source.sourceModuleId === targetModuleId || result.has(source.sourceModuleId)) continue;
      result.add(source.sourceModuleId);
      queue.push(source.sourceModuleId);
    }
  }
  return [...result];
}

function walk(block: WorkspaceBlock, visit: (block: WorkspaceBlock) => void): void {
  visit(block);
  for (const input of Object.values(block.inputs ?? {})) {
    if (input.block) walk(input.block, visit);
    if (input.shadow) walk(input.shadow, visit);
  }
  if (block.next) walk(block.next.block, visit);
}
