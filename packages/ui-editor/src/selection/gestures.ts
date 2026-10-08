import { Blockly } from "../blocks";
import { intersecting, toggleSelection } from "./selection";
export function installSelection(
  element: HTMLElement,
  ws: Blockly.WorkspaceSvg,
  changed: (ids: string[]) => void,
  moved: () => void,
) {
  let ids: string[] = [];
  let gesture:
    | {
        kind: "toggle" | "marquee" | "move";
        pointer: number;
        x: number;
        y: number;
        positions: Map<string, { x: number; y: number }>;
        moved: boolean;
      }
    | undefined;
  const marquee = document.createElement("div");
  marquee.className = "selection-marquee";
  marquee.hidden = true;
  element.append(marquee);
  const publish = (next: string[]) => {
    const current = next.filter((id) =>
      ws.getTopBlocks(false).some((b) => b.id === id),
    );
    const different = JSON.stringify(ids) !== JSON.stringify(current);
    ids = current;
    for (const b of ws.getAllBlocks(false))
      b.getSvgRoot()?.toggleAttribute(
        "data-blocky-selected",
        ids.includes(b.id),
      );
    if (different) changed([...ids]);
  };
  const targetBlock = (target: EventTarget | null) =>
    target instanceof Element
      ? ws.getTopBlocks(false).find((b) => b.getSvgRoot()?.contains(target))
      : undefined;
  const suppress = (event: PointerEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const down = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element &&
        event.target.closest(
          "input,textarea,select,.blocklyScrollbarHorizontal,.blocklyScrollbarVertical",
        ))
    )
      return;
    const root = targetBlock(event.target)?.getRootBlock();
    const background =
      event.target instanceof Element &&
      (event.target.classList.contains("blocklyMainBackground") ||
        event.target === ws.getParentSvg());
    if (event.shiftKey && root) {
      publish(toggleSelection(ids, root.id));
      gesture = {
        kind: "toggle",
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        positions: new Map(),
        moved: false,
      };
    } else if (root && ids.length > 1 && ids.includes(root.id)) {
      gesture = {
        kind: "move",
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        positions: new Map(
          ids.map((id) => [id, ws.getBlockById(id)!.getRelativeToSurfaceXY()]),
        ),
        moved: false,
      };
    } else if (background) {
      for (const b of ws.getAllBlocks(false)) b.unselect();
      publish([]);
      gesture = {
        kind: "marquee",
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        positions: new Map(),
        moved: false,
      };
    } else {
      if (root) publish([root.id]);
      return;
    }
    suppress(event);
    element.setPointerCapture(event.pointerId);
  };
  const positionBlocks = (dx: number, dy: number) => {
    Blockly.Events.disable();
    try {
      for (const [id, start] of gesture!.positions) {
        const block = ws.getBlockById(id);
        if (block) {
          const position = block.getRelativeToSurfaceXY();
          block.moveBy(start.x + dx - position.x, start.y + dy - position.y);
        }
      }
    } finally {
      Blockly.Events.enable();
    }
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    suppress(event);
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3)
      gesture.moved = true;
    if (gesture.kind === "move")
      positionBlocks(
        (event.clientX - gesture.x) / ws.scale,
        (event.clientY - gesture.y) / ws.scale,
      );
    if (gesture.kind === "marquee") {
      const rect = {
        left: Math.min(event.clientX, gesture.x),
        right: Math.max(event.clientX, gesture.x),
        top: Math.min(event.clientY, gesture.y),
        bottom: Math.max(event.clientY, gesture.y),
      };
      const base = element.getBoundingClientRect();
      Object.assign(marquee.style, {
        left: `${rect.left - base.left}px`,
        top: `${rect.top - base.top}px`,
        width: `${rect.right - rect.left}px`,
        height: `${rect.bottom - rect.top}px`,
      });
      marquee.hidden = false;
      publish(
        intersecting(
          rect,
          ws
            .getTopBlocks(false)
            .map((b) => ({
              id: b.id,
              rect: b.getSvgRoot().getBoundingClientRect(),
            })),
        ),
      );
    }
  };
  const up = (event: PointerEvent) => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    suppress(event);
    if (gesture.kind === "move") {
      if (event.type === "pointercancel") positionBlocks(0, 0);
      else if (gesture.moved) moved();
      else positionBlocks(0, 0);
    }
    gesture = undefined;
    marquee.hidden = true;
    if (element.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
  };
  const cancel = () => {
    if (!gesture) return;
    if (gesture.kind === "move") positionBlocks(0, 0);
    const pointer = gesture.pointer;
    gesture = undefined;
    marquee.hidden = true;
    if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
  };
  const lost = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) cancel(); };
  element.addEventListener("pointerdown", down, true);
  element.addEventListener("pointermove", move, true);
  element.addEventListener("pointerup", up, true);
  element.addEventListener("pointercancel", up, true);
  element.addEventListener("lostpointercapture", lost, true);
  window.addEventListener("blur", cancel);
  return {
    cancel,
    current: () => [...ids],
    refresh: () => publish(ids),
    selectAll: () => publish(ws.getTopBlocks(false).map((b) => b.id)),
    clear: () => {
      cancel();
      for (const b of ws.getAllBlocks(false)) b.unselect();
      publish([]);
    },
    selected(id: string | null) {
      const root = id && ws.getBlockById(id)?.getRootBlock();
      if (root && !ids.includes(root.id)) publish([root.id]);
    },
    collapse(value: boolean) {
      Blockly.Events.setGroup(true);
      try {
        for (const id of ids) ws.getBlockById(id)?.setCollapsed(value);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    dispose() {
      cancel();
      element.removeEventListener("pointerdown", down, true);
      element.removeEventListener("pointermove", move, true);
      element.removeEventListener("pointerup", up, true);
      element.removeEventListener("pointercancel", up, true);
      element.removeEventListener("lostpointercapture", lost, true);
      window.removeEventListener("blur", cancel);
      marquee.remove();
    },
  };
}
