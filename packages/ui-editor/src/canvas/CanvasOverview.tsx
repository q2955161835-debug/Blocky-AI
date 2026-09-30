import { useMemo, useState } from "react";
import { overviewBounds, type Overview } from "./overview";

export function CanvasOverview({ data, focus, center }: { data: Overview; focus(id: string): void; center(x: number, y: number): void }) {
  const [query, setQuery] = useState("");
  const bounds = useMemo(() => overviewBounds(data.blocks.filter(b => b.root), data.viewport), [data]);
  const matches = useMemo(() => data.blocks.filter(b => `${b.label} ${b.id} ${b.note ?? ""} ${b.group ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [data.blocks, query]);
  return <aside className="canvas-overview" aria-label="画布导航">
    <details>
      <summary>画布大纲 · {data.blocks.length}{data.omitted ? "+" : ""}</summary>
      <input aria-label="查找画布积木" placeholder="名称、ID、分组或注释" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="canvas-outline" aria-label="积木大纲">
        {matches.slice(0, 200).map(block => <button key={block.id} onClick={() => focus(block.id)} style={{ paddingLeft: 8 + Math.min(block.depth, 8) * 10 }} title={block.id}>
          <span>{block.label}</span>{block.group && <small>{block.group}</small>}{block.note && <small>注释：{block.note}</small>}
        </button>)}
        {!matches.length && <p>没有匹配的积木</p>}
        {(matches.length > 200 || data.omitted > 0) && <p>当前最多列出 200 项；缩小查找范围可定位更多积木。{data.omitted > 0 ? `另有 ${data.omitted} 项未载入大纲。` : ""}</p>}
      </div>
    </details>
    <details>
      <summary>迷你地图</summary>
      <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img" aria-label="画布位置概览"
        onClick={event => {
          const svg = event.currentTarget, matrix = svg.getScreenCTM();
          if (!matrix) return;
          const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
          const location = point.matrixTransform(matrix.inverse()); center(location.x, location.y);
        }}>
        {data.blocks.filter(b => b.root).map(block => <rect key={block.id} x={block.x} y={block.y} width={Math.max(1, block.width)} height={Math.max(1, block.height)} className="overview-block" />)}
        <rect x={data.viewport.x} y={data.viewport.y} width={Math.max(1, data.viewport.width)} height={Math.max(1, data.viewport.height)} className="overview-viewport" />
      </svg>
    </details>
  </aside>;
}
