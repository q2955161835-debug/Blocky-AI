import { describe, expect, it } from "vitest";
import {
  normalizeClipboardBlocks,
  rectFromPoints,
  rectIntersects,
  selectionMoveDelta,
  toggleSelection,
} from "../../src/blockly/CanvasInteraction";

describe("CanvasInteraction", () => {
  it("normalizes marquee rectangles and uses intersection semantics", () => {
    expect(rectFromPoints({ x: 20, y: 40 }, { x: -5, y: 12 })).toEqual({
      left: -5,
      top: 12,
      right: 20,
      bottom: 40,
    });
    expect(rectIntersects(
      { left: 0, top: 0, right: 20, bottom: 20 },
      { left: 18, top: 18, right: 50, bottom: 60 },
    )).toBe(true);
    expect(rectIntersects(
      { left: 0, top: 0, right: 20, bottom: 20 },
      { left: 21, top: 21, right: 50, bottom: 60 },
    )).toBe(false);
  });

  it("adds, removes, and replaces local multi-selection deterministically", () => {
    expect(toggleSelection(new Set(["a"]), "b", true)).toEqual(new Set(["a", "b"]));
    expect(toggleSelection(new Set(["a", "b"]), "a", true)).toEqual(new Set(["b"]));
    expect(toggleSelection(new Set(["a", "b"]), "c", false)).toEqual(new Set(["c"]));
  });

  it("computes the peer movement delta from the primary selected block", () => {
    expect(selectionMoveDelta(
      { x: 100, y: 80 },
      { x: 124, y: 68 },
    )).toEqual({ dx: 24, dy: -12 });
  });

  it("strips all persisted ids and preserves positions relative to the group origin", () => {
    const normalized = normalizeClipboardBlocks([
      {
        type: "core.agent.define",
        id: "root-a",
        x: 140,
        y: 80,
        next: { block: { type: "core.interaction.chat_entry", id: "child-a" } },
      },
      {
        type: "core.tool.call",
        id: "root-b",
        x: 220,
        y: 130,
      },
    ]);

    expect(normalized).toEqual([
      {
        type: "core.agent.define",
        x: 0,
        y: 0,
        next: { block: { type: "core.interaction.chat_entry" } },
      },
      {
        type: "core.tool.call",
        x: 80,
        y: 50,
      },
    ]);
    expect(JSON.stringify(normalized)).not.toContain("root-a");
    expect(JSON.stringify(normalized)).not.toContain("child-a");
  });
});
