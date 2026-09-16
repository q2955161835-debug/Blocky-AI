export type Rect = { left: number; top: number; right: number; bottom: number };
export function toggleSelection(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}
export function intersecting(rect: Rect, items: { id: string; rect: Rect }[]) {
  return items
    .filter(
      ({ rect: b }) =>
        b.right >= rect.left &&
        b.left <= rect.right &&
        b.bottom >= rect.top &&
        b.top <= rect.bottom,
    )
    .map((item) => item.id);
}
