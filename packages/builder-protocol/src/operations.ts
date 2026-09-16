import type { Project, WorkspaceBlock } from "@blocky/language-schema";
import { parseProject, configureBlock } from "@blocky/project-model";
import { getBlock, walkBlocks } from "@blocky/block-catalog";
import type { PatchOperation } from "./validate";

export function projectWithOperations(
  project: Project,
  operations: PatchOperation[],
): Project {
  const next = structuredClone(project);
  for (const operation of operations) {
    const roots = next.workspaces[operation.moduleId]?.blocks.blocks;
    if (!roots) throw Error("BLK-PATCH-002");
    const index = roots.findIndex((b) => b.id === operation.blockId);
    switch (operation.op) {
      case "block.add": {
        const b = operation.payload as WorkspaceBlock;
        if (!b || b.id !== operation.blockId) throw Error("BLK-PATCH-002");
        roots.push(structuredClone(b));
        break;
      }
      case "block.update":
        for (const [field, value] of Object.entries(operation.payload.fields))
          configureBlock(
            next,
            operation.moduleId,
            operation.blockId,
            field,
            value,
          );
        break;
      case "block.move":
        if (index < 0) throw Error("BLK-PATCH-002");
        roots[index].x = operation.payload.x;
        roots[index].y = operation.payload.y;
        break;
      case "block.remove":
        if (index < 0) throw Error("BLK-PATCH-002");
        roots.splice(index, 1);
        break;
    }
  }
  const result = parseProject(next);
  for (const workspace of Object.values(result.workspaces))
    for (const b of walkBlocks(workspace.blocks.blocks)) {
      const definition = getBlock(b.type);
      if (
        !definition ||
        Object.keys(b.fields ?? {}).some((k) => !definition.fields.includes(k))
      )
        throw Error("BLK-PATCH-002");
    }
  return result;
}
