import type { WorkspaceBlock } from "@blocky/language-schema";
import { BlockPreview } from "@blocky/ui-editor";
export function GhostBlocks({ block }: { block: WorkspaceBlock | null }) {
  return block ? (
    <BlockPreview block={block} />
  ) : (
    <span className="muted">无积木</span>
  );
}
