import { describe, expect, it } from "vitest";
import {
  findNearestFreePosition,
  rectanglesOverlap,
  type PlacementRect,
} from "../../src/blockly/blockPlacement";

const occupied: PlacementRect = {
  id: "occupied",
  left: 0,
  top: 0,
  right: 200,
  bottom: 100,
};

describe("block placement", () => {
  it("treats the configured safety gap as occupied space", () => {
    expect(rectanglesOverlap(
      { id: "near", left: 0, top: 110, right: 200, bottom: 210 },
      occupied,
      24,
    )).toBe(true);
    expect(rectanglesOverlap(
      { id: "clear", left: 0, top: 124, right: 200, bottom: 224 },
      occupied,
      24,
    )).toBe(false);
  });

  it("finds the nearest deterministic free grid origin", () => {
    const moving: PlacementRect = {
      id: "moving",
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
    };

    expect(findNearestFreePosition(moving, [occupied], {
      gap: 24,
      step: 24,
      maxRings: 100,
    })).toEqual({ x: 0, y: 144 });
    expect(findNearestFreePosition(moving, [occupied], {
      gap: 24,
      step: 24,
      maxRings: 100,
    })).toEqual({ x: 0, y: 144 });
  });

  it("keeps an already free block at its current origin", () => {
    const moving: PlacementRect = {
      id: "moving",
      left: 300,
      top: 300,
      right: 420,
      bottom: 360,
    };

    expect(findNearestFreePosition(moving, [occupied])).toEqual({
      x: 300,
      y: 300,
    });
  });
});
