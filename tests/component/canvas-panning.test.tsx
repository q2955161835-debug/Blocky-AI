// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installCanvasPanning, type CanvasPointerMode } from "../../packages/ui-editor/src/canvas/pointerPanning";

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });

function setup(initial: CanvasPointerMode = "default") {
  const root = document.createElement("div");
  root.tabIndex = 0;
  const block = document.createElement("div");
  block.className = "blocklyDraggable";
  const field = document.createElement("span");
  block.append(field); root.append(block); document.body.append(root);
  let mode = initial, space = false;
  const capture = new Set<number>();
  root.setPointerCapture = id => { capture.add(id); };
  root.hasPointerCapture = id => capture.has(id);
  root.releasePointerCapture = id => { capture.delete(id); };
  const viewport = { scrollX: -40, scrollY: -80, scroll: vi.fn((x: number, y: number) => { viewport.scrollX = x; viewport.scrollY = y; }) };
  const changed = vi.fn();
  const pan = installCanvasPanning(root, viewport, { mode: () => mode, space: () => space, changed });
  const select = vi.fn(), edit = vi.fn(), search = vi.fn();
  root.addEventListener("pointerdown", select, true);
  field.addEventListener("mousedown", edit);
  root.addEventListener("dblclick", search);
  disposers.push(pan.dispose);
  return { root, block, field, viewport, changed, select, edit, search, capture, pan,
    mode: (next: CanvasPointerMode) => { pan.cancel(); mode = next; }, space: (next: boolean) => { space = next; } };
}
function pointer(target: Element, type: string, x = 30, y = 50, button = 0, id = 7) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, button, pointerId: id });
  target.dispatchEvent(event); return event;
}

it("pure drag claims left gestures on blocks and fields before selection, editing or double-click search", () => {
  const s = setup("pan");
  expect(pointer(s.field, "pointerdown").defaultPrevented).toBe(true);
  pointer(s.root, "pointermove", 90, 100);
  pointer(s.root, "pointerup", 90, 100);
  s.field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  s.field.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  expect(s.viewport.scroll).toHaveBeenCalledExactlyOnceWith(20, -30);
  expect(s.select).not.toHaveBeenCalled(); expect(s.edit).not.toHaveBeenCalled(); expect(s.search).not.toHaveBeenCalled();
  expect(s.capture.size).toBe(0);
  expect(s.changed.mock.calls.map(call => call[0])).toEqual([true, false]);
  pointer(s.root, "pointerdown"); pointer(s.root, "pointermove", 40, 60); pointer(s.root, "pointerup");
  expect(s.select).not.toHaveBeenCalled();
});

it("default mode keeps left editing and selection, while middle and Space-left pan in the drag direction", () => {
  const s = setup();
  pointer(s.field, "pointerdown");
  s.field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(s.select).toHaveBeenCalledTimes(1); expect(s.edit).toHaveBeenCalledTimes(1);
  pointer(s.root, "pointerdown", 30, 50, 1); pointer(s.root, "pointermove", 50, 90, 1); pointer(s.root, "pointerup", 50, 90, 1);
  expect(s.viewport.scroll).toHaveBeenLastCalledWith(-20, -40);
  s.space(true); pointer(s.root, "pointerdown"); pointer(s.root, "pointermove", 20, 40); pointer(s.root, "pointerup");
  expect(s.viewport.scroll).toHaveBeenLastCalledWith(-30, -50);
  s.mode("pan"); s.mode("default"); s.space(false); pointer(s.field, "pointerdown");
  expect(s.select).toHaveBeenCalledTimes(2);
});

it("ignores other pointers and releases capture on cancellation, mode changes and window blur", () => {
  const s = setup("pan");
  pointer(s.root, "pointerdown"); pointer(s.root, "pointermove", 100, 100, 0, 8); pointer(s.root, "pointerup", 100, 100, 0, 8);
  expect(s.viewport.scroll).not.toHaveBeenCalled(); expect(s.capture.has(7)).toBe(true);
  pointer(s.root, "pointercancel"); expect(s.capture.size).toBe(0);
  pointer(s.root, "pointerdown"); s.mode("default"); expect(s.capture.size).toBe(0);
  s.mode("pan"); pointer(s.root, "pointerdown"); window.dispatchEvent(new Event("blur")); expect(s.capture.size).toBe(0);
  pointer(s.root, "pointermove", 100, 100); expect(s.viewport.scroll).not.toHaveBeenCalled();
});

it("lets mode controls and right click work without starting or swallowing a pan", () => {
  const s = setup("pan");
  const controls = document.createElement("button"); controls.dataset.canvasControls = "true"; s.root.append(controls);
  const click = vi.fn(); controls.addEventListener("click", click);
  expect(pointer(controls, "pointerdown").defaultPrevented).toBe(false);
  controls.dispatchEvent(new MouseEvent("click", { bubbles: true })); expect(click).toHaveBeenCalledOnce();
  expect(pointer(s.field, "pointerdown", 30, 50, 2).defaultPrevented).toBe(false);
  expect(s.capture.size).toBe(0);
});
