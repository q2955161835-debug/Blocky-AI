import type { Project, WorkspaceBlock } from "@blocky/language-schema";
import { getBlock } from "@blocky/block-catalog";
export function findBlock(
  blocks: WorkspaceBlock[],
  id: string,
): WorkspaceBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findBlock(
      [
        ...Object.values(block.inputs ?? {}).flatMap(
          (v) => [v.block, v.shadow].filter(Boolean) as WorkspaceBlock[],
        ),
        ...(block.next ? [block.next.block] : []),
      ],
      id,
    );
    if (child) return child;
  }
}
/** Applies one declared field to a transaction draft, without owning I/O or history. */
export function configureBlock(
  project: Project,
  moduleId: string,
  blockId: string,
  field: string,
  value: string,
) {
  const block = findBlock(
    project.workspaces[moduleId]?.blocks.blocks ?? [],
    blockId,
  );
  const definition = block && getBlock(block.type);
  if (
    !block ||
    !definition?.fields.includes(field) ||
    typeof value !== "string" ||
    value.length > 16000 ||
    (field === "STYLE" && !["条目", "段落"].includes(value))
  )
    throw Error("BLK-CONFIG-001");
  block.fields ??= {};
  block.fields[field] = value;
}
