import { stableId, type Project } from "@blocky/language-schema";
function name(value: string) {
  if (!value.trim() || value.length > 120 || /[\u0000-\u001f]/u.test(value))
    throw Error("BLK-MODULE-002");
  return value.trim();
}
export function createModule(
  project: Project,
  id: string,
  displayName: string,
): void {
  const label = name(displayName);
  if (
    !stableId.test(id) ||
    project.manifest.modules.some((m) => m.moduleId === id) ||
    project.manifest.modules.length >= 100
  )
    throw Error("BLK-MODULE-001");
  project.manifest.modules.push({
    moduleId: id,
    displayName: label,
    purpose: "general",
    workspaceRef: `workspaces/${id}.workspace.json`,
    exports: [],
  });
  project.workspaces[id] = { blocks: { languageVersion: 0, blocks: [] } };
}
export function renameModule(
  project: Project,
  id: string,
  displayName: string,
): void {
  const label = name(displayName);
  const module = project.manifest.modules.find((m) => m.moduleId === id);
  if (!module) throw Error("BLK-MODULE-001");
  module.displayName = label;
}
export function deleteModule(project: Project, id: string): void {
  if (
    project.manifest.modules.length <= 1 ||
    !Object.hasOwn(project.workspaces, id)
  )
    throw Error("BLK-MODULE-003");
  // Keep call sites and page references so the compiler can locate their broken targets.
  project.manifest.modules = project.manifest.modules.filter(
    (m) => m.moduleId !== id,
  );
  delete project.workspaces[id];
}
