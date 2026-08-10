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
import { compileInteractionManifest, type InteractionManifest } from "../core/interactionManifest";
import type { BlockyProgram } from "../core/ir";
import { canonicalizeJson, type JsonValue } from "../core/json";
import { compileToolRegistry, type ToolContract } from "../core/toolContract";
import { registerSpikeBlocks } from "./definitions";
import { loadWorkspace, saveWorkspace } from "./workspaceAdapter";
import { LOCAL_TOOLBOX } from "./toolbox";

export interface BlocklyCanvasHandle {
  load(state: JsonValue): void;
  save(): JsonValue;
  blockCount(): number;
  highlight(blockId: string | null): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
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
  const flyout = workspace.getToolbox()?.getFlyout();
  const flyoutWidth = flyout?.isVisible() ? flyout.getWidth() : 0;
  if (flyoutWidth > 0) {
    const metrics = workspace.getMetrics();
    const bounds = workspace.getBlocksBoundingBox();
    const horizontalScale =
      (metrics.viewWidth - flyoutWidth - 48) / bounds.getWidth();
    const verticalScale = (metrics.viewHeight - 48) / bounds.getHeight();
    workspace.setScale(
      Math.max(Math.min(horizontalScale, verticalScale, 0.9), 0.4),
    );
    workspace.scrollCenter();
    const centeredFlyoutOffset = Math.max(flyoutWidth / 2 - 24, 0);
    workspace.scroll(
      workspace.scrollX + centeredFlyoutOffset,
      workspace.scrollY,
    );
    return;
  }
  workspace.zoomToFit();
  workspace.setScale(Math.max(workspace.scale / 1.1, 0.4));
  workspace.scrollCenter();
}

function selectFirstToolboxCategory(workspace: Blockly.WorkspaceSvg): void {
  const toolbox = workspace.getToolbox();
  const firstToolboxItem = toolbox?.getToolboxItems()[0];
  if (!toolbox || !firstToolboxItem) return;
  if (toolbox.getSelectedItem() === firstToolboxItem) {
    toolbox.refreshSelection();
    return;
  }
  toolbox.setSelectedItem(firstToolboxItem);
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
  const fitFrameRef = useRef<number | null>(null);
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

  const cancelScheduledFit = (): void => {
    if (fitFrameRef.current === null) return;
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(fitFrameRef.current);
    } else {
      window.clearTimeout(fitFrameRef.current);
    }
    fitFrameRef.current = null;
  };

  const requestLayoutFrame = (callback: FrameRequestCallback): number => {
    if (typeof window.requestAnimationFrame === "function") {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(() => callback(performance.now()), 0);
  };

  const scheduleFitAfterToolboxLayout = (
    workspace: Blockly.WorkspaceSvg,
  ): void => {
    cancelScheduledFit();
    fitFrameRef.current = requestLayoutFrame(() => {
      fitFrameRef.current = requestLayoutFrame(() => {
        fitFrameRef.current = null;
        Blockly.svgResize(workspace);
        fitWorkspace(workspace);
        selectFirstToolboxCategory(workspace);
      });
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      load(state) {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        Blockly.Events.disable();
        try {
          workspace.clear();
          loadWorkspace(state, workspace);
        } finally {
          Blockly.Events.enable();
        }
        Blockly.svgResize(workspace);
        selectFirstToolboxCategory(workspace);
        scheduleFitAfterToolboxLayout(workspace);
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
        window.setTimeout(
          workspace.endCanvasTransition.bind(workspace),
          500,
        );
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
      toolbox: LOCAL_TOOLBOX,
      renderer: "geras",
      trashcan: true,
      grid: {
        spacing: 24,
        length: 2,
        colour: "#d9e1ec",
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
      scheduleProjection();
    };
    workspace.addChangeListener(changeListener);

    Blockly.Events.disable();
    try {
      loadWorkspace(initialState, workspace);
    } finally {
      Blockly.Events.enable();
    }
    selectFirstToolboxCategory(workspace);
    Blockly.svgResize(workspace);
    scheduleFitAfterToolboxLayout(workspace);
    flushProjection();

    const resize = (): void => Blockly.svgResize(workspace);
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
      cancelScheduledFit();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      workspace.removeChangeListener(changeListener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="blockly-canvas" aria-label="Blockly 画布" />;
}

export const BlocklyCanvas = forwardRef(BlocklyCanvasInner);
