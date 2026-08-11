import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import * as Blockly from "blockly/core";
import * as ZhHans from "blockly/msg/zh-hans";
import { compileWorkspace } from "../core/compileWorkspace";
import type { Diagnostic } from "../core/diagnostics";
import {
  compileInteractionManifest,
  type InteractionManifest,
} from "../core/interactionManifest";
import type { BlockyProgram } from "../core/ir";
import { canonicalizeJson, type JsonValue } from "../core/json";
import { compileToolRegistry, type ToolContract } from "../core/toolContract";
import type { BlockInsertRequest } from "./BlockLibrary";
import { repairTopLevelOverlaps } from "./blockPlacement";
import {
  normalizeClipboardBlocks,
  rectFromPoints,
  rectIntersects,
  selectionMoveDelta,
  toggleSelection,
  type CanvasPoint,
  type CanvasTool,
  type MarqueeRect,
} from "./CanvasInteraction";
import { registerSpikeBlocks } from "./definitions";
import { getSpikeBlockCategory } from "./toolbox";
import { loadWorkspace, saveWorkspace } from "./workspaceAdapter";

export interface BlocklyViewState {
  readonly scale: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly topBlocks: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}

export interface BlocklyCanvasHandle {
  load(state: JsonValue): void;
  save(): JsonValue;
  blockCount(): number;
  highlight(blockId: string | null): void;
  insertBlock(request: BlockInsertRequest): string | null;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  canPaste(): boolean;
  setTool(tool: CanvasTool): void;
  getTool(): CanvasTool;
  selectAll(): void;
  cutSelection(): void;
  copySelection(): void;
  pasteSelection(): void;
  deleteSelection(): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  fitToView(): void;
  resizePreservingView(): void;
  captureViewState(): BlocklyViewState;
}

export interface CanvasViewState {
  readonly zoomPercent: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canPaste: boolean;
  readonly tool: CanvasTool;
  readonly selectionCount: number;
}

export interface EditorProjection {
  readonly workspace: JsonValue;
  readonly program: BlockyProgram;
  readonly sourceMap: Readonly<Record<string, { readonly nodeId: string }>>;
  readonly interactionManifest: InteractionManifest;
  readonly toolContracts: readonly Readonly<ToolContract>[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface BlocklyCanvasProps {
  initialState: JsonValue;
  onProjection(projection: EditorProjection): void;
  onViewStateChange?(state: CanvasViewState): void;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

const zhHansMessages = Object.fromEntries(
  Object.entries(ZhHans).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string",
  ),
);

function fitWorkspace(workspace: Blockly.WorkspaceSvg): void {
  if (workspace.getAllBlocks(false).length === 0) return;
  workspace.zoomToFit();
  workspace.setScale(Math.max(workspace.scale / 1.1, 0.4));
  workspace.scrollCenter();
}

function captureWorkspaceView(workspace: Blockly.WorkspaceSvg): BlocklyViewState {
  return {
    scale: workspace.scale,
    scrollX: workspace.scrollX,
    scrollY: workspace.scrollY,
    topBlocks: [...workspace.getTopBlocks(true)]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((block) => {
        const bounds = block.getBoundingRectangle();
        return {
          id: block.id,
          x: bounds.left,
          y: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        };
      }),
  };
}

function restoreWorkspaceView(
  workspace: Blockly.WorkspaceSvg,
  view: Pick<BlocklyViewState, "scale" | "scrollX" | "scrollY">,
): void {
  if (workspace.scale !== view.scale) workspace.setScale(view.scale);

  // WorkspaceSvg.scroll intentionally clamps against the current content
  // bounds. A panel resize or project load must preserve the user's canvas
  // transform even when those bounds change, so restore the translation using
  // the same un-clamped path Blockly uses for top-level workspace metrics.
  workspace.scrollX = view.scrollX;
  workspace.scrollY = view.scrollY;
  const metrics = workspace.getMetrics();
  workspace.translate(
    view.scrollX + metrics.absoluteLeft,
    view.scrollY + metrics.absoluteTop,
  );
}

function resizePreservingWorkspaceView(workspace: Blockly.WorkspaceSvg): void {
  const view = captureWorkspaceView(workspace);
  Blockly.svgResize(workspace);
  restoreWorkspaceView(workspace, view);
}

export function buildEditorProjection(workspaceState: unknown): EditorProjection {
  const workspace = canonicalizeJson(workspaceState);
  const compilation = compileWorkspace(workspace);
  const interactions = compileInteractionManifest(compilation.program);
  const tools = compileToolRegistry(compilation.program);
  const projection: EditorProjection = {
    workspace,
    program: compilation.program,
    sourceMap: compilation.sourceMap,
    interactionManifest: interactions.manifest,
    toolContracts: [...tools.contracts.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    diagnostics: [
      ...compilation.diagnostics,
      ...interactions.diagnostics,
      ...tools.diagnostics,
    ],
  };
  return deepFreeze(projection);
}

function BlocklyCanvasInner(
  { initialState, onProjection, onViewStateChange }: BlocklyCanvasProps,
  ref: ForwardedRef<BlocklyCanvasHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repairingRef = useRef(false);
  const onProjectionRef = useRef(onProjection);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const [tool, setToolState] = useState<CanvasTool>("select");
  const toolRef = useRef<CanvasTool>("select");
  const selectedRootIdsRef = useRef<ReadonlySet<string>>(new Set());
  const clipboardRef = useRef<readonly Blockly.serialization.blocks.State[]>([]);
  const spacePanRef = useRef(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const pointerInteractionRef = useRef<
    | {
        readonly kind: "marquee";
        readonly pointerId: number;
        readonly startClient: CanvasPoint;
        readonly startWorkspace: CanvasPoint;
        readonly additive: boolean;
        readonly initialSelection: ReadonlySet<string>;
      }
    | {
        readonly kind: "pan";
        readonly pointerId: number;
        previousClient: CanvasPoint;
      }
    | null
  >(null);
  const blockDragRef = useRef<{
    readonly pointerId: number;
    readonly primaryId: string;
    readonly start: CanvasPoint;
    readonly peerIds: readonly string[];
  } | null>(null);
  onProjectionRef.current = onProjection;
  onViewStateChangeRef.current = onViewStateChange;

  const notifyViewState = (): void => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    onViewStateChangeRef.current?.({
      zoomPercent: Math.round(workspace.scale * 100),
      canUndo: workspace.getUndoStack().length > 0,
      canRedo: workspace.getRedoStack().length > 0,
      canPaste: clipboardRef.current.length > 0,
      tool: toolRef.current,
      selectionCount: selectedRootIdsRef.current.size,
    });
  };

  const applySelection = (selection: ReadonlySet<string>): void => {
    selectedRootIdsRef.current = new Set(selection);
    const workspace = workspaceRef.current;
    if (workspace) {
      for (const block of workspace.getTopBlocks(false)) {
        block.getSvgRoot().classList.toggle(
          "blocky-multi-selected",
          selection.has(block.id),
        );
      }
    }
    notifyViewState();
  };

  const setCanvasTool = (nextTool: CanvasTool): void => {
    toolRef.current = nextTool;
    setToolState(nextTool);
    notifyViewState();
  };

  const selectedRoots = (): Blockly.BlockSvg[] => {
    const workspace = workspaceRef.current;
    if (!workspace) return [];
    return [...selectedRootIdsRef.current]
      .map((id) => workspace.getBlockById(id))
      .filter((block): block is Blockly.BlockSvg =>
        block instanceof Blockly.BlockSvg && !block.getParent(),
      );
  };

  const deleteSelectedRoots = (): void => {
    const roots = selectedRoots();
    if (roots.length === 0) return;
    Blockly.Events.setGroup(true);
    try {
      const workspace = workspaceRef.current;
      const deletionEvents = roots.map((block) =>
        new Blockly.Events.BlockDelete(block),
      );
      Blockly.Events.disable();
      try {
        for (const block of roots) block.dispose(false, true);
      } finally {
        Blockly.Events.enable();
      }
      for (const event of deletionEvents) workspace?.fireChangeListener(event);
    } finally {
      Blockly.Events.setGroup(false);
    }
    applySelection(new Set());
    flushProjection();
  };

  const flushProjection = (): EditorProjection | null => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const workspace = workspaceRef.current;
    if (!workspace) return null;
    const projection = buildEditorProjection(saveWorkspace(workspace));
    onProjectionRef.current(projection);
    return projection;
  };

  const scheduleProjection = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushProjection();
    }, 75);
  };

  const repairOverlaps = (
    workspace: Blockly.WorkspaceSvg,
    preferredBlockId?: string,
  ): void => {
    if (repairingRef.current) return;
    repairingRef.current = true;
    try {
      repairTopLevelOverlaps(workspace, preferredBlockId);
    } finally {
      repairingRef.current = false;
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      load(state) {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        const view = captureWorkspaceView(workspace);
        Blockly.Events.disable();
        try {
          workspace.clear();
          loadWorkspace(state, workspace);
          repairOverlaps(workspace);
        } finally {
          Blockly.Events.enable();
        }
        Blockly.svgResize(workspace);
        restoreWorkspaceView(workspace, view);
        applySelection(new Set());
        flushProjection();
      },
      save() {
        const workspace = workspaceRef.current;
        if (!workspace) return canonicalizeJson(initialState);
        flushProjection();
        return saveWorkspace(workspace);
      },
      blockCount() {
        return workspaceRef.current?.getAllBlocks(false).length ?? 0;
      },
      highlight(blockId) {
        workspaceRef.current?.highlightBlock(blockId);
      },
      insertBlock(request) {
        const workspace = workspaceRef.current;
        if (!workspace || !getSpikeBlockCategory(request.blockType)) return null;
        let block: Blockly.BlockSvg | null = null;
        let creationEvent: Blockly.Events.BlockCreate | null = null;
        Blockly.Events.setGroup(true);
        Blockly.Events.disable();
        try {
          block = workspace.newBlock(request.blockType);
          block.initSvg();
          block.render();
          const metrics = workspace.getMetrics();
          const containerBounds = containerRef.current?.getBoundingClientRect();
          const x = request.clientPoint && containerBounds
            ? metrics.viewLeft +
              (request.clientPoint.clientX - containerBounds.left) / workspace.scale
            : metrics.viewLeft + 48;
          const y = request.clientPoint && containerBounds
            ? metrics.viewTop +
              (request.clientPoint.clientY - containerBounds.top) / workspace.scale
            : metrics.viewTop + 48;
          const bounds = block.getBoundingRectangle();
          block.moveBy(x - bounds.left, y - bounds.top);
          repairOverlaps(workspace, block.id);
          // Programmatic creation normally reaches the undo stack on Blockly's
          // deferred event queue. Capture one atomic event at the final,
          // collision-free position so an immediate Undo command is reliable.
          creationEvent = new Blockly.Events.BlockCreate(block);
        } catch {
          block?.dispose(false, true);
          return null;
        } finally {
          Blockly.Events.enable();
          Blockly.Events.setGroup(false);
        }
        workspace.fireChangeListener(creationEvent);
        return block.id;
      },
      undo() {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        workspace.undo(false);
        applySelection(new Set());
        flushProjection();
        notifyViewState();
      },
      redo() {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        workspace.undo(true);
        applySelection(new Set());
        flushProjection();
        notifyViewState();
      },
      canUndo() {
        return (workspaceRef.current?.getUndoStack().length ?? 0) > 0;
      },
      canRedo() {
        return (workspaceRef.current?.getRedoStack().length ?? 0) > 0;
      },
      canPaste() {
        return clipboardRef.current.length > 0;
      },
      setTool(nextTool) {
        setCanvasTool(nextTool);
      },
      getTool() {
        return toolRef.current;
      },
      selectAll() {
        const workspace = workspaceRef.current;
        applySelection(new Set(workspace?.getTopBlocks(false).map((block) => block.id)));
      },
      copySelection() {
        const states = selectedRoots()
          .map((root) => Blockly.serialization.blocks.save(root, {
            addCoordinates: true,
            saveIds: false,
          }))
          .filter((state): state is Blockly.serialization.blocks.State => state !== null);
        clipboardRef.current = normalizeClipboardBlocks(
          states as unknown as readonly Readonly<Record<string, unknown>>[],
        ) as unknown as readonly Blockly.serialization.blocks.State[];
        notifyViewState();
      },
      cutSelection() {
        const states = selectedRoots()
          .map((root) => Blockly.serialization.blocks.save(root, {
            addCoordinates: true,
            saveIds: false,
          }))
          .filter((state): state is Blockly.serialization.blocks.State => state !== null);
        clipboardRef.current = normalizeClipboardBlocks(
          states as unknown as readonly Readonly<Record<string, unknown>>[],
        ) as unknown as readonly Blockly.serialization.blocks.State[];
        notifyViewState();
        deleteSelectedRoots();
      },
      pasteSelection() {
        const workspace = workspaceRef.current;
        if (!workspace || clipboardRef.current.length === 0) return;
        const metrics = workspace.getMetrics();
        const pastedIds: string[] = [];
        Blockly.Events.setGroup(true);
        try {
          for (const [index, state] of clipboardRef.current.entries()) {
            const x = (state.x ?? 0) + metrics.viewLeft + 48 + index * 12;
            const y = (state.y ?? 0) + metrics.viewTop + 48 + index * 12;
            const block = Blockly.serialization.blocks.append(
              { ...state, x, y },
              workspace,
              { recordUndo: true },
            );
            pastedIds.push(block.id);
          }
        } finally {
          Blockly.Events.setGroup(false);
        }
        for (const id of pastedIds) repairOverlaps(workspace, id);
        applySelection(new Set(pastedIds));
        flushProjection();
      },
      deleteSelection() {
        deleteSelectedRoots();
      },
      zoomIn() {
        workspaceRef.current?.zoomCenter(1);
        notifyViewState();
      },
      zoomOut() {
        workspaceRef.current?.zoomCenter(-1);
        notifyViewState();
      },
      resetZoom() {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        const { startScale, scaleSpeed } = workspace.options.zoomOptions;
        const zoomSteps = Math.log(startScale / workspace.scale)
          / Math.log(scaleSpeed);
        workspace.beginCanvasTransition();
        workspace.zoomCenter(zoomSteps);
        workspace.scrollCenter();
        window.setTimeout(workspace.endCanvasTransition.bind(workspace), 500);
        notifyViewState();
      },
      fitToView() {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        fitWorkspace(workspace);
        notifyViewState();
      },
      resizePreservingView() {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        resizePreservingWorkspaceView(workspace);
      },
      captureViewState() {
        const workspace = workspaceRef.current;
        return workspace
          ? captureWorkspaceView(workspace)
          : { scale: 1, scrollX: 0, scrollY: 0, topBlocks: [] };
      },
    }),
    [initialState],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    Blockly.setLocale(zhHansMessages);
    registerSpikeBlocks();
    const workspace = Blockly.inject(container, {
      media: "./blockly-media/",
      sounds: false,
      toolbox: undefined,
      renderer: "geras",
      trashcan: false,
      grid: {
        spacing: 24,
        length: 2,
        colour: "#3a414c",
        snap: false,
      },
      move: {
        scrollbars: true,
        drag: true,
        wheel: false,
      },
      zoom: {
        controls: false,
        wheel: true,
        startScale: 0.9,
        maxScale: 1.5,
        minScale: 0.4,
        scaleSpeed: 1.1,
      },
    });
    workspaceRef.current = workspace;

    const changeListener = (event: Blockly.Events.Abstract): void => {
      if (event.type === Blockly.Events.VIEWPORT_CHANGE) notifyViewState();
      if (event.isUiEvent) return;
      if (event.type === Blockly.Events.BLOCK_MOVE && !repairingRef.current) {
        const blockId = (event as Blockly.Events.Abstract & { blockId?: string })
          .blockId;
        const block = blockId ? workspace.getBlockById(blockId) : null;
        if (block && !block.getParent()) repairOverlaps(workspace, block.id);
      }
      scheduleProjection();
      notifyViewState();
    };
    workspace.addChangeListener(changeListener);

    Blockly.Events.disable();
    try {
      loadWorkspace(initialState, workspace);
      repairOverlaps(workspace);
    } finally {
      Blockly.Events.enable();
    }
    Blockly.svgResize(workspace);
    flushProjection();
    notifyViewState();

    const resize = (): void => resizePreservingWorkspaceView(workspace);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(resize);
      observer.observe(container);
    } else {
      window.addEventListener("resize", resize);
    }
    resize();

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      workspace.removeChangeListener(changeListener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isTextEditingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return target.matches("input, textarea, select, [contenteditable='true']");
    };
    const clientToWorkspace = (point: CanvasPoint): CanvasPoint => {
      const workspace = workspaceRef.current;
      const bounds = container.getBoundingClientRect();
      if (!workspace) return point;
      const metrics = workspace.getMetrics();
      return {
        x: metrics.viewLeft + (point.x - bounds.left) / workspace.scale,
        y: metrics.viewTop + (point.y - bounds.top) / workspace.scale,
      };
    };
    const workspaceRectToLocal = (
      start: CanvasPoint,
      end: CanvasPoint,
    ): MarqueeRect => {
      const bounds = container.getBoundingClientRect();
      return rectFromPoints(
        { x: start.x - bounds.left, y: start.y - bounds.top },
        { x: end.x - bounds.left, y: end.y - bounds.top },
      );
    };

    const pointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      const workspace = workspaceRef.current;
      if (!workspace) return;
      const target = event.target instanceof Element ? event.target : null;
      const blockRoot = target?.closest<SVGGElement>(".blocklyDraggable") ?? null;
      const persistentPan = toolRef.current === "pan" || spacePanRef.current;
      if (persistentPan) {
        event.preventDefault();
        event.stopPropagation();
        pointerInteractionRef.current = {
          kind: "pan",
          pointerId: event.pointerId,
          previousClient: { x: event.clientX, y: event.clientY },
        };
        container.setPointerCapture?.(event.pointerId);
        return;
      }

      if (blockRoot) {
        const blockId = blockRoot.getAttribute("data-id");
        const selectedBlock = blockId ? workspace.getBlockById(blockId) : null;
        const root = selectedBlock?.getRootBlock();
        if (!root) return;
        const current = selectedRootIdsRef.current;
        const next = event.shiftKey
          ? toggleSelection(current, root.id, true)
          : current.has(root.id) ? current : new Set([root.id]);
        applySelection(next);
        const bounds = root.getBoundingRectangle();
        blockDragRef.current = {
          pointerId: event.pointerId,
          primaryId: root.id,
          start: { x: bounds.left, y: bounds.top },
          peerIds: [...next].filter((id) => id !== root.id),
        };
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const startClient = { x: event.clientX, y: event.clientY };
      pointerInteractionRef.current = {
        kind: "marquee",
        pointerId: event.pointerId,
        startClient,
        startWorkspace: clientToWorkspace(startClient),
        additive: event.shiftKey,
        initialSelection: new Set(selectedRootIdsRef.current),
      };
      setMarquee(workspaceRectToLocal(startClient, startClient));
      container.setPointerCapture?.(event.pointerId);
    };

    const pointerMove = (event: PointerEvent): void => {
      const interaction = pointerInteractionRef.current;
      const workspace = workspaceRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId || !workspace) return;
      event.preventDefault();
      if (interaction.kind === "pan") {
        const dx = event.clientX - interaction.previousClient.x;
        const dy = event.clientY - interaction.previousClient.y;
        interaction.previousClient = { x: event.clientX, y: event.clientY };
        workspace.scrollX += dx;
        workspace.scrollY += dy;
        const metrics = workspace.getMetrics();
        workspace.translate(
          workspace.scrollX + metrics.absoluteLeft,
          workspace.scrollY + metrics.absoluteTop,
        );
        notifyViewState();
        return;
      }
      setMarquee(workspaceRectToLocal(interaction.startClient, {
        x: event.clientX,
        y: event.clientY,
      }));
    };

    const pointerFinish = (event: PointerEvent): void => {
      const workspace = workspaceRef.current;
      const interaction = pointerInteractionRef.current;
      if (interaction && interaction.pointerId === event.pointerId && workspace) {
        if (interaction.kind === "marquee") {
          const selectionRect = rectFromPoints(
            interaction.startWorkspace,
            clientToWorkspace({ x: event.clientX, y: event.clientY }),
          );
          const matches = workspace.getTopBlocks(false)
            .filter((block) => {
              const bounds = block.getBoundingRectangle();
              return rectIntersects(selectionRect, {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom,
              });
            })
            .map((block) => block.id);
          applySelection(interaction.additive
            ? new Set([...interaction.initialSelection, ...matches])
            : new Set(matches));
        }
        pointerInteractionRef.current = null;
        setMarquee(null);
        container.releasePointerCapture?.(event.pointerId);
      }

      const blockDrag = blockDragRef.current;
      if (!blockDrag || blockDrag.pointerId !== event.pointerId || !workspace) return;
      blockDragRef.current = null;
      const primary = workspace.getBlockById(blockDrag.primaryId);
      if (!primary) return;
      const bounds = primary.getBoundingRectangle();
      const delta = selectionMoveDelta(blockDrag.start, {
        x: bounds.left,
        y: bounds.top,
      });
      if (delta.dx === 0 && delta.dy === 0) return;
      Blockly.Events.setGroup(true);
      try {
        for (const peerId of blockDrag.peerIds) {
          workspace.getBlockById(peerId)?.moveBy(delta.dx, delta.dy);
        }
      } finally {
        Blockly.Events.setGroup(false);
      }
      for (const selectedId of selectedRootIdsRef.current) {
        repairOverlaps(workspace, selectedId);
      }
      flushProjection();
    };

    const keyDown = (event: KeyboardEvent): void => {
      if (isTextEditingTarget(event.target)) return;
      if (event.code === "Space") {
        spacePanRef.current = true;
        event.preventDefault();
      } else if (event.key.toLocaleLowerCase("en-US") === "v") {
        setCanvasTool("select");
      } else if (event.key.toLocaleLowerCase("en-US") === "h") {
        setCanvasTool("pan");
      } else if (event.key === "Escape") {
        applySelection(new Set());
      }
    };
    const keyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") spacePanRef.current = false;
    };

    container.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointermove", pointerMove, { passive: false });
    window.addEventListener("pointerup", pointerFinish);
    window.addEventListener("pointercancel", pointerFinish);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      container.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerFinish);
      window.removeEventListener("pointercancel", pointerFinish);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []);

  return (
    <div className={`blockly-canvas-surface blockly-canvas-surface--${tool}`}>
      <div
        ref={containerRef}
        className="blockly-canvas"
        aria-label="Blockly 画布"
      />
      {marquee ? (
        <div
          className="blockly-selection-marquee"
          aria-hidden="true"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
          }}
        />
      ) : null}
    </div>
  );
}

export const BlocklyCanvas = forwardRef(BlocklyCanvasInner);
