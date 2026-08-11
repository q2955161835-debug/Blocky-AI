export type CanvasTool = "select" | "pan";

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface MarqueeRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CanvasInteractionState {
  readonly tool: CanvasTool;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly marquee: MarqueeRect | null;
}

export function rectFromPoints(
  start: CanvasPoint,
  end: CanvasPoint,
): MarqueeRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function rectIntersects(
  left: MarqueeRect,
  right: MarqueeRect,
): boolean {
  return left.left <= right.right &&
    left.right >= right.left &&
    left.top <= right.bottom &&
    left.bottom >= right.top;
}

export function toggleSelection(
  selection: ReadonlySet<string>,
  blockId: string,
  additive: boolean,
): ReadonlySet<string> {
  if (!additive) return new Set([blockId]);
  const next = new Set(selection);
  if (next.has(blockId)) next.delete(blockId);
  else next.add(blockId);
  return next;
}

export function selectionMoveDelta(
  start: CanvasPoint,
  end: CanvasPoint,
): { readonly dx: number; readonly dy: number } {
  return { dx: end.x - start.x, dy: end.y - start.y };
}

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "id")
      .map(([key, child]) => [key, stripIds(child)]),
  );
}

export function normalizeClipboardBlocks(
  roots: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  if (roots.length === 0) return [];
  const minimumX = Math.min(...roots.map((root) =>
    typeof root.x === "number" ? root.x : 0,
  ));
  const minimumY = Math.min(...roots.map((root) =>
    typeof root.y === "number" ? root.y : 0,
  ));
  return roots.map((root) => {
    const normalized = stripIds(root) as Record<string, unknown>;
    if (typeof root.x === "number") normalized.x = root.x - minimumX;
    if (typeof root.y === "number") normalized.y = root.y - minimumY;
    return normalized;
  });
}
