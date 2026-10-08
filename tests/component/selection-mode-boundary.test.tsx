// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installSelection } from "../../packages/ui-editor/src/selection/gestures";
import type { Blockly } from "../../packages/ui-editor/src/blocks";

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
function pointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { button: 0, pointerId: 9, clientX: x, clientY: y }); target.dispatchEvent(event);
}
it("cancels an in-progress multi-block move, restores positions and keeps selection without committing undo", () => {
  const root = document.createElement("div"), capture = new Set<number>(); document.body.append(root);
  root.setPointerCapture = id => { capture.add(id); }; root.hasPointerCapture = id => capture.has(id); root.releasePointerCapture = id => { capture.delete(id); };
  const blocks = ["first", "second"].map((id, index) => {
    const element = document.createElement("div"); root.append(element);
    let position = { x: index * 100, y: 30 };
    const block = { id, getSvgRoot: () => element, getRootBlock: () => block, unselect: vi.fn(), getRelativeToSurfaceXY: () => ({ ...position }),
      moveBy: (x: number, y: number) => { position = { x: position.x + x, y: position.y + y }; } };
    return block;
  });
  const ws = { scale: 1, getTopBlocks: () => blocks, getAllBlocks: () => blocks, getBlockById: (id: string) => blocks.find(block => block.id === id), getParentSvg: () => root } as unknown as Blockly.WorkspaceSvg;
  const moved = vi.fn(), changed = vi.fn();
  const selection = installSelection(root, ws, changed, moved); disposers.push(selection.dispose);
  selection.selectAll();
  pointer(blocks[0].getSvgRoot(), "pointerdown", 20, 30); pointer(root, "pointermove", 50, 60);
  expect(blocks[0].getRelativeToSurfaceXY()).toEqual({ x: 30, y: 60 });
  selection.cancel();
  expect(blocks.map(block => block.getRelativeToSurfaceXY())).toEqual([{ x: 0, y: 30 }, { x: 100, y: 30 }]);
  expect(selection.current()).toEqual(["first", "second"]); expect(capture.size).toBe(0);
  pointer(root, "pointermove", 80, 90); pointer(root, "pointerup", 80, 90); expect(moved).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledTimes(1);
  pointer(blocks[0].getSvgRoot(), "pointerdown", 20, 30); pointer(root, "pointermove", 30, 40); pointer(root, "pointerup", 30, 40);
  expect(moved).toHaveBeenCalledOnce();
});
