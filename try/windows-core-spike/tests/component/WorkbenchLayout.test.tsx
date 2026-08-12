import { createRef } from "react";
import * as Blockly from "blockly/core";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BlocklyCanvas,
  type BlocklyCanvasHandle,
  type BlocklyViewState,
} from "../../src/blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import "../../src/app/app.css";

const EMPTY_WORKSPACE = {
  blocks: { languageVersion: 0, blocks: [] },
};

const OVERLAPPING_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      { type: "core.data.literal", id: "legacy-left", x: 24, y: 24 },
      { type: "core.data.literal", id: "legacy-right", x: 24, y: 24 },
    ],
  },
};

function hasOverlap(state: BlocklyViewState): boolean {
  return state.topBlocks.some((left, leftIndex) =>
    state.topBlocks.slice(leftIndex + 1).some((right) => !(
      left.x + left.width <= right.x ||
      right.x + right.width <= left.x ||
      left.y + left.height <= right.y ||
      right.y + right.height <= left.y
    )),
  );
}

describe("Blockly workbench layout invariants", () => {
  it("keeps canvas scrollbar thumbs slender without shrinking the interaction track", async () => {
    render(
      <BlocklyCanvas
        initialState={EMPTY_WORKSPACE}
        onProjection={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".blocklyScrollbarVertical")).not.toBeNull();
      expect(document.querySelector(".blocklyScrollbarHorizontal")).not.toBeNull();
    });
    const verticalTrack = document.querySelector<SVGElement>(
      ".blocklyScrollbarVertical",
    );
    const verticalThumb = document.querySelector<SVGRectElement>(
      ".blocklyScrollbarVertical .blocklyScrollbarHandle",
    );
    const horizontalTrack = document.querySelector<SVGElement>(
      ".blocklyScrollbarHorizontal",
    );
    const horizontalThumb = document.querySelector<SVGRectElement>(
      ".blocklyScrollbarHorizontal .blocklyScrollbarHandle",
    );
    if (!verticalTrack || !verticalThumb || !horizontalTrack || !horizontalThumb) {
      throw new Error("Expected both Blockly scrollbar tracks and thumbs.");
    }

    expect(Number(verticalTrack.getAttribute("width"))).toBeGreaterThanOrEqual(15);
    expect(Number(horizontalTrack.getAttribute("height"))).toBeGreaterThanOrEqual(15);
    expect(getComputedStyle(verticalThumb).width).toBe("6px");
    expect(getComputedStyle(horizontalThumb).height).toBe("6px");
    expect(getComputedStyle(verticalThumb).fillOpacity).toBe("0.62");
  });

  it("uses select mode, canvas-owned wheel zoom, and no Blockly trashcan", async () => {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    render(
      <BlocklyCanvas
        ref={canvasRef}
        initialState={EMPTY_WORKSPACE}
        onProjection={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasRef.current).not.toBeNull());
    const workspace = Blockly.getMainWorkspace();
    if (!(workspace instanceof Blockly.WorkspaceSvg)) {
      throw new Error("Expected the rendered Blockly workspace.");
    }
    expect(workspace.options.hasTrashcan).toBe(false);
    expect(workspace.options.moveOptions.wheel).toBe(false);
    expect(workspace.options.zoomOptions.wheel).toBe(false);
    expect(canvasRef.current?.getTool()).toBe("select");

    const zoom = vi.spyOn(workspace, "zoom").mockImplementation(() => {});
    const canvas = document.querySelector<HTMLElement>(".blockly-canvas");
    if (!canvas) throw new Error("Expected the Blockly canvas element.");
    fireEvent.wheel(canvas, { deltaY: -120, clientX: 120, clientY: 120 });
    expect(zoom).toHaveBeenCalledWith(120, 120, 1);
  });

  it("preserves the complete workspace transform during resize-only layout changes", async () => {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    render(
      <BlocklyCanvas
        ref={canvasRef}
        initialState={createHundredBlockWorkspaceState()}
        onProjection={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasRef.current?.blockCount()).toBe(100));
    const before = canvasRef.current?.captureViewState();
    canvasRef.current?.resizePreservingView();
    const after = canvasRef.current?.captureViewState();

    expect(after).toEqual(before);
    expect(after && hasOverlap(after)).toBe(false);
  });

  it("loads another workspace without fitting, centering, or changing scale", async () => {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    render(
      <BlocklyCanvas
        ref={canvasRef}
        initialState={EMPTY_WORKSPACE}
        onProjection={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasRef.current).not.toBeNull());
    const before = canvasRef.current?.captureViewState();
    canvasRef.current?.load(createHundredBlockWorkspaceState());
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const after = canvasRef.current?.captureViewState();

    expect(after?.scale).toBe(before?.scale);
    expect(after?.scrollX).toBe(before?.scrollX);
    expect(after?.scrollY).toBe(before?.scrollY);
  });

  it("repairs top-level overlap already present in a legacy workspace", async () => {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    render(
      <BlocklyCanvas
        ref={canvasRef}
        initialState={OVERLAPPING_WORKSPACE}
        onProjection={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasRef.current?.blockCount()).toBe(2));
    const repaired = canvasRef.current?.captureViewState();
    expect(repaired && hasOverlap(repaired)).toBe(false);
  });

  it("inserts, undoes, and redoes authentic top-level blocks without overlap", async () => {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    render(
      <BlocklyCanvas
        ref={canvasRef}
        initialState={EMPTY_WORKSPACE}
        onProjection={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasRef.current).not.toBeNull());
    expect(canvasRef.current?.insertBlock({ blockType: "core.data.literal" }))
      .toBeTruthy();
    expect(canvasRef.current?.insertBlock({ blockType: "core.data.literal" }))
      .toBeTruthy();
    expect(canvasRef.current?.blockCount()).toBe(2);
    const inserted = canvasRef.current?.captureViewState();
    expect(inserted && hasOverlap(inserted)).toBe(false);

    canvasRef.current?.undo();
    expect(canvasRef.current?.blockCount()).toBe(1);
    canvasRef.current?.redo();
    expect(canvasRef.current?.blockCount()).toBe(2);
  });

  it("treats multi-block clipboard and deletion as undoable group operations", async () => {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    const onViewStateChange = vi.fn();
    render(
      <BlocklyCanvas
        ref={canvasRef}
        initialState={EMPTY_WORKSPACE}
        onProjection={vi.fn()}
        onViewStateChange={onViewStateChange}
      />,
    );

    await waitFor(() => expect(canvasRef.current).not.toBeNull());
    canvasRef.current?.insertBlock({ blockType: "core.data.literal" });
    canvasRef.current?.insertBlock({ blockType: "core.data.literal" });
    canvasRef.current?.selectAll();
    expect(onViewStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionCount: 2 }),
    );
    const workspace = Blockly.getMainWorkspace();
    if (!(workspace instanceof Blockly.WorkspaceSvg)) {
      throw new Error("Expected the rendered Blockly workspace.");
    }
    expect(workspace.getTopBlocks(false).every((block) =>
      block.getSvgRoot().getAttribute("data-blocky-selected") === "true",
    )).toBe(true);

    canvasRef.current?.copySelection();
    canvasRef.current?.deleteSelection();
    expect(canvasRef.current?.blockCount()).toBe(0);
    canvasRef.current?.undo();
    expect(canvasRef.current?.blockCount()).toBe(2);
    canvasRef.current?.selectAll();
    canvasRef.current?.pasteSelection();
    expect(canvasRef.current?.blockCount()).toBe(4);
    const pasted = canvasRef.current?.captureViewState();
    expect(pasted && hasOverlap(pasted)).toBe(false);
  });

  it("repairs a top-level block dragged onto another block", async () => {
    const canvasRef = createRef<BlocklyCanvasHandle>();
    render(
      <BlocklyCanvas
        ref={canvasRef}
        initialState={EMPTY_WORKSPACE}
        onProjection={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasRef.current).not.toBeNull());
    canvasRef.current?.insertBlock({ blockType: "core.data.literal" });
    canvasRef.current?.insertBlock({ blockType: "core.data.literal" });
    const workspace = Blockly.getMainWorkspace();
    if (!(workspace instanceof Blockly.WorkspaceSvg)) {
      throw new Error("Expected the rendered Blockly workspace.");
    }
    const [left, right] = workspace.getTopBlocks(true);
    if (!left || !right) throw new Error("Expected two top-level blocks.");
    const leftBounds = left.getBoundingRectangle();
    const rightBounds = right.getBoundingRectangle();
    right.moveBy(
      leftBounds.left - rightBounds.left,
      leftBounds.top - rightBounds.top,
    );
    workspace.fireChangeListener(new Blockly.Events.BlockMove(right));

    const repaired = canvasRef.current?.captureViewState();
    expect(repaired && hasOverlap(repaired)).toBe(false);
  });
});
