import { useEffect, useMemo, useRef, useState } from "react";
import {
  BlockLibrary,
  getBlockDisplayName,
  type BlockPointerDragStart,
} from "../blockly/BlockLibrary";
import {
  BlocklyCanvas,
  type BlocklyCanvasHandle,
  type CanvasViewState,
} from "../blockly/BlocklyCanvas";
import { CanvasToolControls } from "../blockly/CanvasToolControls";
import {
  countSerializedBlocks,
} from "../blockly/fixtures";
import {
  SPIKE_BLOCK_CATEGORIES,
  type SpikeBlockCategoryId,
} from "../blockly/toolbox";
import { BuilderPlaceholder } from "../builder/BuilderPlaceholder";
import type { JsonValue } from "../core/json";
import type { RuntimeDependencies } from "../core/deterministicRuntime";
import type { HostBridge } from "../host/HostBridge";
import { RuntimePanel } from "../runtime/RuntimePanel";
import { indexProgramBlockTypes } from "../runtime/eventPresentation";
import { CanvasControls } from "./CanvasControls";
import { DesktopTitleBar } from "./DesktopTitleBar";
import {
  createWorkbenchCommands,
  type CommandBlockItem,
  type WorkbenchCommandId,
} from "./commands";
import {
  NoopWindowChromeBridge,
  type WindowChromeBridge,
} from "./WindowChromeBridge";
import { useSpikeController } from "./useSpikeController";
import "./app.css";

export interface AppProps {
  hostBridge: HostBridge;
  initialWorkspace?: JsonValue;
  projectId?: string;
  runtimeModel?: RuntimeDependencies["model"];
  canvasAction?: CanvasAction;
  windowChrome?: WindowChromeBridge;
}

export interface CanvasAction {
  readonly ariaLabel: string;
  readonly label: string;
  run(): void;
}

const EMPTY_WORKSPACE: JsonValue = {
  blocks: { blocks: [], languageVersion: 0 },
};

const NOOP_WINDOW_CHROME = new NoopWindowChromeBridge();

export function App({
  hostBridge,
  initialWorkspace = EMPTY_WORKSPACE,
  projectId = "windows-core-spike",
  runtimeModel,
  windowChrome = NOOP_WINDOW_CHROME,
}: AppProps) {
  const canvasRef = useRef<BlocklyCanvasHandle>(null);
  const canvasStageRef = useRef<HTMLElement>(null);
  const externalDragCleanupRef = useRef<(() => void) | null>(null);
  const [activeTab, setActiveTab] = useState<"builder" | "runtime">("runtime");
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<SpikeBlockCategoryId>("agents");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [canvasView, setCanvasView] = useState<CanvasViewState>({
    zoomPercent: 90,
    canUndo: false,
    canRedo: false,
    canPaste: false,
    tool: "select",
    selectionCount: 0,
  });
  const controller = useSpikeController({
    canvasRef,
    hostBridge,
    projectId,
    runtimeModel,
  });
  const hasEntry = controller.projection.interactionManifest.entries.length > 0;
  const hasCompileError = controller.projection.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  const blockCount = countSerializedBlocks(controller.projection.workspace);
  const runtimeBlockTypes = useMemo(
    () => indexProgramBlockTypes(controller.projection.program),
    [controller.projection.program],
  );
  const blockSearchItems = useMemo<readonly CommandBlockItem[]>(
    () => SPIKE_BLOCK_CATEGORIES.flatMap((category) =>
      category.blockIds.map((blockType) => ({
        kind: "block" as const,
        blockType,
        label: getBlockDisplayName(blockType),
        categoryName: category.name,
        keywords: [category.name],
      })),
    ),
    [],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      canvasRef.current?.resizePreservingView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [leftCollapsed, rightCollapsed]);

  useEffect(() => () => externalDragCleanupRef.current?.(), []);

  const handleBlockPointerDragStart = (request: BlockPointerDragStart): void => {
    externalDragCleanupRef.current?.();
    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== request.pointerId) return;
      const bounds = canvasStageRef.current?.getBoundingClientRect();
      if (
        bounds &&
        event.clientX >= bounds.left && event.clientX <= bounds.right &&
        event.clientY >= bounds.top && event.clientY <= bounds.bottom
      ) {
        canvasRef.current?.insertBlock({
          blockType: request.blockType,
          clientPoint: { clientX: event.clientX, clientY: event.clientY },
        });
      }
      cleanup();
    };
    const cleanup = (): void => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (externalDragCleanupRef.current === cleanup) {
        externalDragCleanupRef.current = null;
      }
    };
    externalDragCleanupRef.current = cleanup;
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const runCommand = (id: WorkbenchCommandId): void => {
    switch (id) {
      case "file.new":
        void controller.replaceWorkspace(EMPTY_WORKSPACE);
        break;
      case "file.open":
        void controller.loadProject();
        break;
      case "file.save":
      case "file.saveAs":
        void controller.saveProject();
        break;
      case "file.exit":
        void windowChrome.close();
        break;
      case "edit.undo":
        canvasRef.current?.undo();
        break;
      case "edit.redo":
        canvasRef.current?.redo();
        break;
      case "edit.selectAll":
        canvasRef.current?.selectAll();
        break;
      case "edit.cut":
        canvasRef.current?.cutSelection();
        break;
      case "edit.copy":
        canvasRef.current?.copySelection();
        break;
      case "edit.paste":
        canvasRef.current?.pasteSelection();
        break;
      case "edit.delete":
        canvasRef.current?.deleteSelection();
        break;
      case "view.toggleLeft":
        setLeftCollapsed((current) => !current);
        break;
      case "view.toggleRight":
        setRightCollapsed((current) => !current);
        break;
      case "view.zoomIn":
        canvasRef.current?.zoomIn();
        break;
      case "view.zoomOut":
        canvasRef.current?.zoomOut();
        break;
      case "view.resetZoom":
        canvasRef.current?.resetZoom();
        break;
      case "view.fit":
        canvasRef.current?.fitToView();
        break;
      case "view.selectTool":
        canvasRef.current?.setTool("select");
        break;
      case "view.panTool":
        canvasRef.current?.setTool("pan");
        break;
      case "help.quickStart":
        setRightCollapsed(false);
        setActiveTab("builder");
        break;
      case "help.shortcuts":
      case "help.about":
        break;
    }
  };
  const commands = createWorkbenchCommands({
    state: {
      canUndo: canvasView.canUndo,
      canRedo: canvasView.canRedo,
      selectionCount: canvasView.selectionCount,
      canPaste: canvasView.canPaste,
      leftCollapsed,
      rightCollapsed,
      tool: canvasView.tool,
    },
    run: runCommand,
  });

  return (
    <div className="app-shell">
      <DesktopTitleBar
        commands={commands}
        blockSearchItems={blockSearchItems}
        documentLabel="天气助手 · 已保存"
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onInsertBlock={(blockType) => canvasRef.current?.insertBlock({ blockType })}
        windowChrome={windowChrome}
      />

      <main
        className={[
          "workbench",
          leftCollapsed ? "workbench--left-collapsed" : "",
          rightCollapsed ? "workbench--right-collapsed" : "",
        ].filter(Boolean).join(" ")}
      >
        <span className="sr-only">Blocky Windows 核心尖峰</span>
        {leftCollapsed ? null : (
          <div className="workbench__library">
            <BlockLibrary
              selectedCategoryId={selectedCategoryId}
              onSelectedCategoryIdChange={setSelectedCategoryId}
              onInsert={(request) => canvasRef.current?.insertBlock(request)}
              onPointerDragStart={handleBlockPointerDragStart}
            />
          </div>
        )}

        <section
          ref={canvasStageRef}
          className="canvas-stage"
          aria-label="积木画布区"
        >
          <div className="canvas-stage__badge" aria-label="画布积木数量">
            <span aria-hidden="true" />
            画布 · {blockCount} 个积木
          </div>
          <BlocklyCanvas
            ref={canvasRef}
            initialState={initialWorkspace}
            onProjection={controller.acceptProjection}
            onViewStateChange={setCanvasView}
          />
          <CanvasToolControls
            tool={canvasView.tool}
            onToolChange={(nextTool) => canvasRef.current?.setTool(nextTool)}
          />
          <CanvasControls
            zoomPercent={canvasView.zoomPercent}
            onSave={() => void controller.saveProject()}
            onZoomOut={() => {
              canvasRef.current?.zoomOut();
            }}
            onZoomIn={() => {
              canvasRef.current?.zoomIn();
            }}
            onFit={() => {
              canvasRef.current?.fitToView();
            }}
          />
          {controller.operationError ? (
            <p className="app-operation-error" role="alert">
              {controller.operationError}
            </p>
          ) : null}
        </section>

        <aside
          className="assistant-panel"
          aria-label="运行与搭建面板"
          hidden={rightCollapsed}
        >
          <div className="assistant-tabs" role="tablist" aria-label="右侧工作区">
            <button
              id="builder-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === "builder"}
              aria-controls="builder-panel"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setActiveTab("builder")}
            >
              搭建助手
            </button>
            <button
              id="runtime-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === "runtime"}
              aria-controls="runtime-panel"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setActiveTab("runtime")}
              disabled={!hasEntry}
            >
              运行 Agent
            </button>
          </div>

          <div className="assistant-panel__body">
            <div
              id="builder-panel"
              role="tabpanel"
              aria-labelledby="builder-tab"
              hidden={activeTab !== "builder"}
            >
              <BuilderPlaceholder />
            </div>
            <div
              id="runtime-panel"
              role="tabpanel"
              aria-labelledby="runtime-tab"
              hidden={activeTab !== "runtime"}
            >
              <RuntimePanel
                manifest={controller.projection.interactionManifest}
                activeEntryId={controller.activeEntryId}
                onActiveEntryIdChange={controller.setActiveEntryId}
                onSubmit={controller.runInput}
                events={controller.runtime.events}
                blockTypes={runtimeBlockTypes}
                disabled={controller.runtime.status === "running" || hasCompileError}
                running={controller.runtime.status === "running"}
                pendingPermission={controller.pendingPermission}
                onCancel={() => void controller.cancelRun()}
                onApprovePermission={controller.approvePermission}
                onDenyPermission={controller.denyPermission}
              />
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
