import type * as Blockly from "blockly/core";

export interface PlacementPoint {
  readonly x: number;
  readonly y: number;
}

export interface PlacementRect {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PlacementOptions {
  readonly gap: number;
  readonly step: number;
  readonly maxRings: number;
}

export interface PlacementMove {
  readonly blockId: string;
  readonly dx: number;
  readonly dy: number;
}

const DEFAULT_OPTIONS: PlacementOptions = Object.freeze({
  gap: 24,
  step: 24,
  maxRings: 1_000,
});

export function rectanglesOverlap(
  left: PlacementRect,
  right: PlacementRect,
  gap = DEFAULT_OPTIONS.gap,
): boolean {
  return !(
    left.right + gap <= right.left ||
    right.right + gap <= left.left ||
    left.bottom + gap <= right.top ||
    right.bottom + gap <= left.top
  );
}

function translatedRect(
  source: PlacementRect,
  point: PlacementPoint,
): PlacementRect {
  const width = source.right - source.left;
  const height = source.bottom - source.top;
  return {
    id: source.id,
    left: point.x,
    top: point.y,
    right: point.x + width,
    bottom: point.y + height,
  };
}

function ringOffsets(radius: number): readonly PlacementPoint[] {
  const offsets: PlacementPoint[] = [
    { x: 0, y: radius },
    { x: radius, y: 0 },
    { x: 0, y: -radius },
    { x: -radius, y: 0 },
  ];
  for (let offset = 1; offset < radius; offset += 1) {
    offsets.push(
      { x: offset, y: radius },
      { x: -offset, y: radius },
      { x: radius, y: offset },
      { x: radius, y: -offset },
      { x: offset, y: -radius },
      { x: -offset, y: -radius },
      { x: -radius, y: offset },
      { x: -radius, y: -offset },
    );
  }
  return offsets;
}

export function findNearestFreePosition(
  moving: PlacementRect,
  occupied: readonly PlacementRect[],
  options: PlacementOptions = DEFAULT_OPTIONS,
): PlacementPoint {
  const original = { x: moving.left, y: moving.top };
  const isFree = (point: PlacementPoint): boolean => {
    const candidate = translatedRect(moving, point);
    return occupied.every((rect) =>
      rect.id === moving.id || !rectanglesOverlap(candidate, rect, options.gap),
    );
  };
  if (isFree(original)) return original;

  for (let radius = 1; radius <= options.maxRings; radius += 1) {
    for (const offset of ringOffsets(radius)) {
      const candidate = {
        x: original.x + offset.x * options.step,
        y: original.y + offset.y * options.step,
      };
      if (isFree(candidate)) return candidate;
    }
  }

  throw new Error("BLOCK_PLACEMENT_EXHAUSTED");
}

function blockBounds(block: Blockly.BlockSvg): PlacementRect {
  const bounds = block.getBoundingRectangle();
  return {
    id: block.id,
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
}

export function repairTopLevelOverlaps(
  workspace: Blockly.WorkspaceSvg,
  preferredBlockId?: string,
): readonly PlacementMove[] {
  const roots = [...workspace.getTopBlocks(true)].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (roots.length < 2) return [];

  const moves: PlacementMove[] = [];
  const moveRoot = (
    root: Blockly.BlockSvg,
    occupied: readonly PlacementRect[],
  ): PlacementRect => {
    const before = blockBounds(root);
    const target = findNearestFreePosition(before, occupied);
    const dx = target.x - before.left;
    const dy = target.y - before.top;
    if (dx !== 0 || dy !== 0) {
      root.moveBy(dx, dy);
      moves.push({ blockId: root.id, dx, dy });
      return translatedRect(before, target);
    }
    return before;
  };

  if (preferredBlockId) {
    const preferred = roots.find((block) => block.id === preferredBlockId);
    if (!preferred) return [];
    moveRoot(
      preferred,
      roots.filter((block) => block !== preferred).map(blockBounds),
    );
    return moves;
  }

  const occupied: PlacementRect[] = [];
  for (const root of roots) occupied.push(moveRoot(root, occupied));
  return moves;
}
