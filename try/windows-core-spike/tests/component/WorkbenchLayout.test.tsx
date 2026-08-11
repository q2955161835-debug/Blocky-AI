import { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BlocklyCanvas,
  type BlocklyCanvasHandle,
  type BlocklyViewState,
} from "../../src/blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";

const EMPTY_WORKSPACE = {
  blocks: { languageVersion: 0, blocks: [] },
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
});
