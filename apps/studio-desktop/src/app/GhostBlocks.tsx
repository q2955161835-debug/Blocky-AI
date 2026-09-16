import type { WorkspaceBlock } from "@blocky/language-schema";
import { getBlock } from "@blocky/block-catalog";
const labels: Record<string, string> = {
  ROLE: "角色",
  NAME: "名称",
  RESOURCE: "资源",
  STYLE: "格式",
  MODULE: "画布",
  EXPORT: "入口",
};
export function GhostBlocks({ block }: { block: WorkspaceBlock | null }) {
  if (!block) return <span className="muted">无积木</span>;
  const definition = getBlock(block.type);
  return (
    <div className="ghost-stack">
      <div className="ghost-block" style={{ borderColor: definition?.color }}>
        <strong>{definition?.label ?? block.type}</strong>
        {Object.entries(block.fields ?? {})
          .filter(([key]) => labels[key])
          .map(([key, value]) => (
            <small key={key}>
              {labels[key]}：{String(value)}
            </small>
          ))}
        {Object.entries(block.inputs ?? {}).map(([name, value]) => (
          <div className="ghost-input" key={name}>
            <GhostBlocks block={value.block ?? value.shadow ?? null} />
          </div>
        ))}
      </div>
      {block.next && <GhostBlocks block={block.next.block} />}
    </div>
  );
}
