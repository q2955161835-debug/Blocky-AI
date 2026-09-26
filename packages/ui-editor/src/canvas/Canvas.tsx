import { useEffect, useRef, useState } from "react";
import { canonicalJson, type Workspace } from "@blocky/language-schema";
import type { RuntimeEvent } from "@blocky/observability";
import { canvasVisuals } from "./runtime-visuals";
import { Blockly, registerBlocks, theme } from "../blocks";
import { installSelection } from "../selection/gestures";
import { CanvasOverview } from "./CanvasOverview";
import { overviewLabels, type Overview } from "./overview";
import { applyCodeVisuals } from "./code-visuals";
export type CanvasHandle = {
  add(type: string): void;
  focus(id: string): void;
  zoom(delta: number): void;
  selectAll(): void;
  clearSelection(): void;
  collapse(value: boolean): void;
};
type Props = {
  workspace: Workspace;
  moduleId: string;
  onChange(value: Workspace, group?: string): void;
  onSelect(id: string | null): void;
  onSelection?(ids: string[]): void;
  onSearch(): void;
  onContext(x: number, y: number, scope: "blank" | "block" | "multi", blockId?: string): void;
  handle: (api: CanvasHandle | null) => void;
  events: RuntimeEvent[];
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
  const selection = useRef<ReturnType<typeof installSelection> | null>(null);
  latest.current = props;
  const [announcement, setAnnouncement] = useState("");
  const [overview, setOverview] = useState<Overview>({ blocks: [], viewport: { x: 0, y: 0, width: 1, height: 1 }, omitted: 0 });
  const refreshOverview = useRef<() => void>(() => {});
  useEffect(() => {
    registerBlocks();
    const el = root.current!;
    const ws = Blockly.inject(el, {
      theme,
      renderer: "zelos",
      trashcan: false,
      comments: false,
      collapse: true,
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
    let overviewFrame = 0, overviewGeometryDirty = false;
    let overviewBlocks: Overview["blocks"] = [], omitted = 0;
    const updateOverview = (geometry = true) => {
      overviewGeometryDirty ||= geometry;
      if (overviewFrame) return;
      overviewFrame = requestAnimationFrame(() => {
        overviewFrame = 0;
        const view = ws.getMetricsManager().getViewMetrics(true);
        if (overviewGeometryDirty) {
          overviewGeometryDirty = false;
          const all = ws.getAllBlocks(true);
          omitted = Math.max(0, all.length - 2000);
          overviewBlocks = all.slice(0, 2000).map(block => {
            const position = block.getRelativeToSurfaceXY(), size = block.getHeightWidth();
            let depth = 0, parent = block.getSurroundParent();
            while (parent && depth < 32) { depth++; parent = parent.getSurroundParent(); }
            return { id: block.id, label: block.toString(80), x: position.x, y: position.y, width: size.width, height: size.height,
              root: !block.getParent(), depth, ...overviewLabels(block.data) };
          });
        }
        setOverview({ viewport: { x: view.left, y: view.top, width: view.width, height: view.height }, omitted, blocks: overviewBlocks });
      });
    };
    refreshOverview.current = updateOverview;
    const listener = (event: Blockly.Events.Abstract) => {
      if (!event.isUiEvent) updateOverview();
      else if (event.type === Blockly.Events.VIEWPORT_CHANGE) updateOverview(false);
      if (event.type === Blockly.Events.VIEWPORT_CHANGE) {
        latest.current.onViewport({
          offsetX: ws.scrollX,
          offsetY: ws.scrollY,
          scale: ws.scale,
        });
        return;
      }
      if (event.type === Blockly.Events.SELECTED) {
        selection.current?.selected(
          (event as Blockly.Events.Selected).newElementId ?? null,
        );
        latest.current.onSelect(
          (event as Blockly.Events.Selected).newElementId ?? null,
        );
        return;
      }
      if (event.isUiEvent) return;
      const value = Blockly.serialization.workspaces.save(ws) as Workspace;
      if (!value.blocks) value.blocks = { languageVersion: 0, blocks: [] };
      if (!value.blocks.blocks) value.blocks.blocks = [];
      applyCodeVisuals(ws, value);
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
      selectAll() {
        selection.current?.selectAll();
      },
      clearSelection() {
        selection.current?.clear();
      },
      collapse(value) {
        selection.current?.collapse(value);
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
      if (e.key === "Tab" && !isInput(e.target)) {
        e.preventDefault();
        latest.current.onSearch();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };
    const down = (e: PointerEvent) => {
      // Selection/panning cancel pointer defaults, including native focus.
      if (!isInput(e.target)) el.focus({ preventScroll: true });
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
      const target = e.target instanceof Element ? e.target : null;
      const element = target?.closest(".blocklyDraggable");
      const id = element?.getAttribute("data-id") ??
        (target ? ws.getAllBlocks(false).find((block) => block.getSvgRoot()?.contains(target))?.id : undefined);
      const blockId = id && ws.getBlockById(id) ? id : undefined;
      const rootId = blockId && ws.getBlockById(blockId)?.getRootBlock().id;
      const selected = selection.current?.current() ?? [];
      const multi = !!rootId && selected.length > 1 && selected.includes(rootId);
      if (blockId) ws.getBlockById(blockId)?.select();
      latest.current.onSelect(blockId ?? null);
      if (rootId && !multi) latest.current.onSelection?.([rootId]);
      latest.current.onContext(e.clientX, e.clientY,
        !blockId ? "blank" : multi ? "multi" : "block",
        blockId);
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
    selection.current = installSelection(
      el,
      ws,
      (ids) => latest.current.onSelection?.(ids),
      () => {
        const value = Blockly.serialization.workspaces.save(ws) as Workspace;
        if (!value.blocks) value.blocks = { languageVersion: 0, blocks: [] };
        if (!value.blocks.blocks) value.blocks.blocks = [];
        serialized.current = canonicalJson(value);
        latest.current.onChange(value, `move-${crypto.randomUUID()}`);
      },
    );
    const observer = new ResizeObserver(() => { Blockly.svgResize(ws); updateOverview(false); });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(overviewFrame);
      refreshOverview.current = () => {};
      selection.current?.dispose();
      selection.current = null;
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
    selection.current?.refresh();
    refreshOverview.current();
  }, [props.workspace, props.moduleId]);
  useEffect(() => {
    if (editor.current) applyCodeVisuals(editor.current, props.workspace);
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
    for (const b of ws.getAllBlocks(false)) {
      b.getSvgRoot()?.removeAttribute("data-runtime-state");
      b.getSvgRoot()?.removeAttribute("data-event-sequence");
    }
    const visuals = canvasVisuals(props.events, props.moduleId);
    const announcements: string[] = [];
    for (const [id, visual] of visuals) {
      const block = ws.getBlockById(id);
      block?.getSvgRoot()?.setAttribute("data-runtime-state", visual.state);
      block
        ?.getSvgRoot()
        ?.setAttribute("data-event-sequence", String(visual.sequence));
      const icon =
        visual.state === "error"
          ? "✖"
          : visual.state === "warning"
            ? "⚠"
            : "▶";
      announcements.push(`${icon} ${visual.label} #${visual.sequence}`);
    }
    setAnnouncement(announcements.join(" · "));
  }, [props.events, props.moduleId, props.workspace]);
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
      <div className="canvas-hint">
        Shift 多选 · 空白框选 · 中键平移 · 滚轮缩放 · Tab 搜索
      </div>
      <div className="runtime-status" role="status">
        {announcement}
      </div>
      <CanvasOverview data={overview} focus={id => {
        const ws = editor.current, block = ws?.getBlockById(id);
        if (ws && block) { block.select(); ws.centerOnBlock(id); }
      }} center={(x, y) => {
        const ws = editor.current;
        if (!ws || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const view = ws.getMetricsManager().getViewMetrics(true);
        ws.scroll(ws.scrollX + (view.left + view.width / 2 - x) * ws.scale, ws.scrollY + (view.top + view.height / 2 - y) * ws.scale);
      }} />
    </div>
  );
}
function isInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input,textarea,select") || target.isContentEditable)
  );
}
