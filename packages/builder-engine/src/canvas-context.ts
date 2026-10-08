import type { Project, WorkspaceBlock } from "@blocky/language-schema";

/** The current editor snapshot, independent of the selected-block list. */
export function currentCanvasContext(project: Project, moduleId: string) {
  const module = project.manifest.modules.find(item => item.moduleId === moduleId)!;
  const blocks = project.workspaces[moduleId].blocks.blocks;
  const pending: WorkspaceBlock[] = [...blocks];
  let blockCount = 0;
  while (pending.length) {
    const block = pending.pop()!;
    blockCount++;
    for (const input of Object.values(block.inputs ?? {})) {
      if (input.block) pending.push(input.block);
      if (input.shadow) pending.push(input.shadow);
    }
    if (block.next?.block) pending.push(block.next.block);
  }
  const metadata = { moduleId, displayName: module.displayName, rootCount: blocks.length, blockCount };
  const full = { ...metadata, complete: true, blocks };
  if (new TextEncoder().encode(JSON.stringify(full)).length <= 65536) return full;
  return {
    ...metadata,
    complete: false,
    readMoreTool: "project_context",
    roots: blocks.slice(0, 100).map(block => ({ id: block.id, type: block.type })),
  };
}
