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
  workspace.setScale(Math.max(workspace.scale / 1.1, 0.5));
  workspace.scrollCenter();
}

function selectFirstToolboxCategory(workspace: Blockly.WorkspaceSvg): void {
  const toolbox = workspace.getToolbox();
  const firstToolboxItem = toolbox?.getToolboxItems()[0];
  if (toolbox && firstToolboxItem) toolbox.setSelectedItem(firstToolboxItem);
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
        fitWorkspace(workspace);
        selectFirstToolboxCategory(workspace);
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
    }),
    [initialState],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    Blockly.setLocale(zhHansMessages);
    registerSpikeBlocks();
    const workspace = Blockly.inject(container, {
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
        minScale: 0.5,
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
    fitWorkspace(workspace);
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
