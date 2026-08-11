import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  BlockLibrary,
  BLOCKY_BLOCK_DRAG_MIME,
  getBlockDisplayName,
} from "../blockly/BlockLibrary";
import {
  BlocklyCanvas,
  type BlocklyCanvasHandle,
} from "../blockly/BlocklyCanvas";
import {
  countSerializedBlocks,
} from "../blockly/fixtures";
import type { SpikeBlockId } from "../blockly/catalog";
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
  const [activeTab, setActiveTab] = useState<"builder" | "runtime">("runtime");
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<SpikeBlockCategoryId>("agents");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(90);
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

  const updateZoomLabel = (): void => {
    const scale = canvasRef.current?.captureViewState().scale;
    if (scale !== undefined) setZoomPercent(Math.round(scale * 100));
  };

  const openRuntime = (): void => {
    setRightCollapsed(false);
    setActiveTab("runtime");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(
        '[data-testid="runtime-text-input"]',
      )?.focus();
    });
  };

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    const blockType = event.dataTransfer.getData(BLOCKY_BLOCK_DRAG_MIME);
    if (!blockType) return;
    event.preventDefault();
    canvasRef.current?.insertBlock({
      blockType: blockType as SpikeBlockId,
      clientPoint: { clientX: event.clientX, clientY: event.clientY },
    });
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
      case "view.toggleLeft":
        setLeftCollapsed((current) => !current);
        break;
      case "view.toggleRight":
        setRightCollapsed((current) => !current);
        break;
      case "view.zoomIn":
        canvasRef.current?.zoomIn();
        updateZoomLabel();
        break;
      case "view.zoomOut":
        canvasRef.current?.zoomOut();
        updateZoomLabel();
        break;
      case "view.resetZoom":
        canvasRef.current?.resetZoom();
        updateZoomLabel();
        break;
      case "view.fit":
        canvasRef.current?.fitToView();
        updateZoomLabel();
        break;
      case "help.quickStart":
        setRightCollapsed(false);
        setActiveTab("builder");
        break;
      case "edit.selectAll":
      case "edit.cut":
      case "edit.copy":
      case "edit.paste":
      case "edit.delete":
      case "view.selectTool":
      case "view.panTool":
      case "help.shortcuts":
      case "help.about":
        break;
    }
  };
  const commands = createWorkbenchCommands({
    state: {
      canUndo: true,
      canRedo: true,
      selectionCount: 0,
      canPaste: false,
      leftCollapsed,
      rightCollapsed,
      tool: "select",
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
            />
          </div>
        )}

        <section
          className="canvas-stage"
          aria-label="积木画布区"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(BLOCKY_BLOCK_DRAG_MIME)) {
              event.preventDefault();
            }
          }}
          onDrop={handleDrop}
        >
          <div className="canvas-stage__badge" aria-label="画布积木数量">
            <span aria-hidden="true" />
            画布 · {blockCount} 个积木
          </div>
          <BlocklyCanvas
            ref={canvasRef}
            initialState={initialWorkspace}
            onProjection={controller.acceptProjection}
          />
          <CanvasControls
            zoomPercent={zoomPercent}
            onSave={() => void controller.saveProject()}
            onRun={openRuntime}
            onZoomOut={() => {
              canvasRef.current?.zoomOut();
              updateZoomLabel();
            }}
            onZoomIn={() => {
              canvasRef.current?.zoomIn();
              updateZoomLabel();
            }}
            onFit={() => {
              canvasRef.current?.fitToView();
              updateZoomLabel();
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
