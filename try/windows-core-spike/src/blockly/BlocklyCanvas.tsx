import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
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
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  fitToView(): void;
  resizePreservingView(): void;
  captureViewState(): BlocklyViewState;
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
  { initialState, onProjection }: BlocklyCanvasProps,
  ref: ForwardedRef<BlocklyCanvasHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repairingRef = useRef(false);
  const onProjectionRef = useRef(onProjection);
  onProjectionRef.current = onProjection;

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
        flushProjection();
      },
      redo() {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        workspace.undo(true);
        flushProjection();
      },
      zoomIn() {
        workspaceRef.current?.zoomCenter(1);
      },
      zoomOut() {
        workspaceRef.current?.zoomCenter(-1);
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
      },
      fitToView() {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        fitWorkspace(workspace);
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
      trashcan: true,
      grid: {
        spacing: 24,
        length: 2,
        colour: "#3a414c",
        snap: false,
      },
      move: {
        scrollbars: true,
        drag: true,
        wheel: true,
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
      if (event.isUiEvent) return;
      if (event.type === Blockly.Events.BLOCK_MOVE && !repairingRef.current) {
        const blockId = (event as Blockly.Events.Abstract & { blockId?: string })
          .blockId;
        const block = blockId ? workspace.getBlockById(blockId) : null;
        if (block && !block.getParent()) repairOverlaps(workspace, block.id);
      }
      scheduleProjection();
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

  return (
    <div
      ref={containerRef}
      className="blockly-canvas"
      aria-label="Blockly 画布"
    />
  );
}

export const BlocklyCanvas = forwardRef(BlocklyCanvasInner);
