import { useEffect, useRef, useState } from "react";
import { canonicalJson, type Workspace } from "@blocky/language-schema";
import { projectVisual, type RuntimeEvent } from "@blocky/observability";
import { Blockly, registerBlocks, theme } from "../blocks";
export type CanvasHandle = {
  add(type: string): void;
  focus(id: string): void;
  zoom(delta: number): void;
};
type Props = {
  workspace: Workspace;
  moduleId: string;
  onChange(value: Workspace, group?: string): void;
  onSelect(id: string | null): void;
  onSearch(): void;
  onContext(x: number, y: number): void;
  handle: (api: CanvasHandle | null) => void;
  event?: RuntimeEvent;
  focusId?: string;
  reduceMotion: boolean;
  viewport?: { offsetX: number; offsetY: number; scale: number };
  onViewport(value: { offsetX: number; offsetY: number; scale: number }): void;
};
export function Canvas(props: Props) {
  const root = useRef<HTMLDivElement>(null),
    latest = useRef(props),
    editor = useRef<Blockly.WorkspaceSvg | null>(null),
    serialized = useRef("");
  latest.current = props;
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    registerBlocks();
    const el = root.current!;
    const ws = Blockly.inject(el, {
      theme,
      renderer: "zelos",
      trashcan: false,
      comments: false,
      collapse: false,
      disable: false,
      sounds: false,
      move: { scrollbars: true, drag: false, wheel: false },
      zoom: {
        controls: false,
        wheel: false,
        startScale: 0.85,
        maxScale: 1.8,
        minScale: 0.35,
      },
      grid: { spacing: 24, length: 1, colour: "#39424e", snap: false },
    });
    editor.current = ws;
    ws.MAX_UNDO = 0;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.type === Blockly.Events.VIEWPORT_CHANGE) {
        latest.current.onViewport({
          offsetX: ws.scrollX,
          offsetY: ws.scrollY,
          scale: ws.scale,
        });
        return;
      }
      if (event.type === Blockly.Events.SELECTED) {
        latest.current.onSelect(
          (event as Blockly.Events.Selected).newElementId ?? null,
        );
        return;
      }
      if (event.isUiEvent) return;
      const value = Blockly.serialization.workspaces.save(ws) as Workspace;
      if (!value.blocks) value.blocks = { languageVersion: 0, blocks: [] };
      if (!value.blocks.blocks) value.blocks.blocks = [];
      serialized.current = canonicalJson(value);
      latest.current.onChange(value, event.group || undefined);
    };
    ws.addChangeListener(listener);
    latest.current.handle({
      add(type) {
        Blockly.Events.setGroup(true);
        try {
          const b = ws.newBlock(type, `block-${crypto.randomUUID()}`);
          b.initSvg();
          b.render();
          b.moveBy(70 - ws.scrollX / ws.scale, 70 - ws.scrollY / ws.scale);
          b.select();
        } finally {
          Blockly.Events.setGroup(false);
        }
      },
      focus(id) {
        const block = ws.getBlockById(id);
        if (block) {
          block.select();
          ws.centerOnBlock(id);
        }
      },
      zoom(delta) {
        ws.zoomCenter(delta);
      },
    });
    let space = false,
      pan: { x: number; y: number; sx: number; sy: number; id: number } | null =
        null;
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isInput(e.target)) {
        space = true;
        e.preventDefault();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ["c", "v", "x"].includes(e.key.toLowerCase())
      )
        e.stopPropagation();
      if (e.key === "Tab" && !isInput(e.target)) {
        e.preventDefault();
        latest.current.onSearch();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };
    const down = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && space)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pan = {
          x: e.clientX,
          y: e.clientY,
          sx: ws.scrollX,
          sy: ws.scrollY,
          id: e.pointerId,
        };
        el.setPointerCapture(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      if (pan) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ws.scroll(pan.sx + e.clientX - pan.x, pan.sy + e.clientY - pan.y);
      }
    };
    const up = (e: PointerEvent) => {
      if (pan) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (el.hasPointerCapture(pan.id)) el.releasePointerCapture(pan.id);
        pan = null;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const bounds = ws.getParentSvg().getBoundingClientRect();
      ws.zoom(
        e.clientX - bounds.left,
        e.clientY - bounds.top,
        e.deltaY > 0 ? -1 : 1,
      );
    };
    const dbl = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".blocklyDraggable")) {
        e.preventDefault();
        latest.current.onSearch();
      }
    };
    const context = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      latest.current.onContext(e.clientX, e.clientY);
    };
    el.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup);
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("wheel", wheel, { capture: true, passive: false });
    el.addEventListener("dblclick", dbl);
    el.addEventListener("contextmenu", context, true);
    const observer = new ResizeObserver(() => Blockly.svgResize(ws));
    observer.observe(el);
    return () => {
      observer.disconnect();
      ws.removeChangeListener(listener);
      latest.current.handle(null);
      editor.current = null;
      window.removeEventListener("keyup", keyup);
      el.removeEventListener("keydown", keydown, true);
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("wheel", wheel, true);
      el.removeEventListener("dblclick", dbl);
      el.removeEventListener("contextmenu", context, true);
      ws.dispose();
    };
  }, [props.moduleId]);
  useEffect(() => {
    const ws = editor.current;
    if (!ws) return;
    const next = canonicalJson(props.workspace);
    if (next === serialized.current) return;
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(props.workspace, ws);
      serialized.current = canonicalJson(
        Blockly.serialization.workspaces.save(ws),
      );
    } finally {
      Blockly.Events.enable();
    }
  }, [props.workspace, props.moduleId]);
  useEffect(() => {
    const ws = editor.current;
    const view = latest.current.viewport;
    if (ws && view) {
      ws.setScale(view.scale);
      ws.scroll(view.offsetX, view.offsetY);
    }
  }, [props.moduleId]);
  useEffect(() => {
    const ws = editor.current;
    if (props.focusId && ws?.getBlockById(props.focusId)) {
      ws.getBlockById(props.focusId)!.select();
      ws.centerOnBlock(props.focusId);
    }
  }, [props.focusId]);
  useEffect(() => {
    const ws = editor.current;
    if (!ws) return;
    for (const b of ws.getAllBlocks(false))
      b.getSvgRoot()?.removeAttribute("data-runtime-state");
    const event = props.event;
    if (!event || event.moduleId !== props.moduleId) {
      setAnnouncement("");
      return;
    }
    const visual = projectVisual(event);
    if (visual && event.blockId) {
      ws.getBlockById(event.blockId)
        ?.getSvgRoot()
        ?.setAttribute("data-runtime-state", visual.state);
      setAnnouncement(visual.label);
    }
  }, [props.event, props.moduleId]);
  return (
    <div
      className={`canvas-shell ${props.reduceMotion ? "reduce-motion" : ""}`}
    >
      <div
        ref={root}
        className="blockly-host"
        tabIndex={0}
        aria-label="积木画布"
      />
      <div className="canvas-hint">中键拖动平移 · 滚轮缩放 · Tab 搜索积木</div>
      <div className="runtime-status" role="status">
        {announcement}
      </div>
    </div>
  );
}
function isInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input,textarea,select") || target.isContentEditable)
  );
}
