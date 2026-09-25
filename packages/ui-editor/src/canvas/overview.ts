export type Rect = { x: number; y: number; width: number; height: number };
export type OverviewBlock = Rect & { id: string; label: string; depth: number; root: boolean; note?: string; group?: string };
export type Overview = { blocks: OverviewBlock[]; viewport: Rect; omitted: number };
export function overviewBounds(blocks: Rect[], viewport: Rect): Rect {
  const values = [...blocks, viewport].filter(r => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0);
  if (!values.length) return { x: 0, y: 0, width: 100, height: 100 };
  const x = Math.min(...values.map(r => r.x)) - 24, y = Math.min(...values.map(r => r.y)) - 24;
  return { x, y, width: Math.max(100, Math.max(...values.map(r => r.x + r.width)) - x + 24), height: Math.max(100, Math.max(...values.map(r => r.y + r.height)) - y + 24) };
}
/** Labels only; malformed editor metadata cannot break navigation or modify the project. */
export function overviewLabels(data: string | null | undefined): { note?: string; group?: string } {
  if (!data || data.length > 16384) return {};
  try {
    const value = JSON.parse(data);
    if (!value || value.schemaVersion !== "blocky.editor/v1") return {};
    return {
      ...(typeof value.note === "string" ? { note: value.note.slice(0, 300) } : {}),
      ...(value.group && typeof value.group.label === "string" && ["group", "region"].includes(value.group.kind)
        ? { group: `${value.group.kind === "region" ? "区域" : "分组"}：${value.group.label.slice(0, 80)}` } : {}),
    };
  } catch { return {}; }
}
