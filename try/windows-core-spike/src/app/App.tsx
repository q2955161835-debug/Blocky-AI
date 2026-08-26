import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BlockLibrary,
  getBlockDisplayName,
  type BlockPointerDragStart,
} from "../blockly/BlockLibrary";
import { BlockPreview } from "../blockly/BlockPreview";
import {
  BlocklyCanvas,
  type BlocklyCanvasHandle,
  type CanvasViewState,
  type EditorProjection,
} from "../blockly/BlocklyCanvas";
import { CanvasToolControls } from "../blockly/CanvasToolControls";
import type { SpikeBlockId } from "../blockly/catalog";
import {
  countSerializedBlocks,
} from "../blockly/fixtures";
import {
  SPIKE_BLOCK_CATEGORIES,
  type SpikeBlockCategoryId,
} from "../blockly/toolbox";
import { BuilderAssistant } from "../builder/BuilderAssistant";
import type { JsonValue } from "../core/json";
import type { RuntimeDependencies } from "../core/deterministicRuntime";
import type { RuntimeEvent } from "../core/runtimeEvents";
import type { BlockyProgram, IrNode } from "../core/ir";
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
import { useDocumentSession } from "./useDocumentSession";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { HelpDialog, type HelpView } from "./HelpDialog";
import "./app.css";

export interface AppProps {
  hostBridge: HostBridge;
  initialWorkspace?: JsonValue;
  projectId?: string;
  runtimeModel?: RuntimeDependencies["model"];
  runtimeStepDelayMs?: number;
  onRuntimeEvent?: (event: RuntimeEvent) => void;
  windowChrome?: WindowChromeBridge;
}

const EMPTY_WORKSPACE: JsonValue = {
  blocks: { blocks: [], languageVersion: 0 },
};

const NOOP_WINDOW_CHROME = new NoopWindowChromeBridge();

function programHasType(program: BlockyProgram, blockType: string): boolean {
  const visited = new Set<string>();
  const visit = (node: IrNode | null): boolean => {
    if (!node || visited.has(node.id)) return false;
    visited.add(node.id);
    return node.type === blockType ||
      Object.values(node.inputs).some(visit) ||
      visit(node.next);
  };
  return program.roots.some(visit);
}

export function App({
  hostBridge,
  initialWorkspace = EMPTY_WORKSPACE,
  projectId = "windows-core-spike",
  runtimeModel,
  runtimeStepDelayMs = 0,
  onRuntimeEvent,
  windowChrome = NOOP_WINDOW_CHROME,
}: AppProps) {
  const canvasRef = useRef<BlocklyCanvasHandle>(null);
  const canvasStageRef = useRef<HTMLElement>(null);
  const externalDragCleanupRef = useRef<(() => void) | null>(null);
  const [activeTab, setActiveTab] = useState<"builder" | "runtime">("builder");
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<SpikeBlockCategoryId>("agents");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [helpView, setHelpView] = useState<HelpView | null>(null);
  const [blockDragPreview, setBlockDragPreview] = useState<{
    readonly blockType: SpikeBlockId;
    readonly clientX: number;
    readonly clientY: number;
  } | null>(null);
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
    runtimeStepDelayMs,
    onRuntimeEvent,
  });
  const documentSession = useDocumentSession({
    canvasRef,
    hostBridge,
    projectId,
    cancelRun: controller.cancelRun,
    onClose: () => void windowChrome.close(),
    initialWorkspace,
  });
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void windowChrome.onCloseRequested(() => {
      void documentSession.requestClose();
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [documentSession.requestClose, windowChrome]);
  const acceptProjection = useCallback((projection: EditorProjection): void => {
    controller.acceptProjection(projection);
    documentSession.acceptWorkspace(projection.workspace);
  }, [controller.acceptProjection, documentSession.acceptWorkspace]);
  const hasAgent = controller.projection.program.roots.some(
    (root) => root.type === "core.agent.define",
  );
  const hasChatBlock = programHasType(
    controller.projection.program,
    "core.interaction.chat_entry",
  );
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
  const insertBlock = useCallback((blockType: SpikeBlockId): string | null =>
    canvasRef.current?.insertBlock({ blockType }) ?? null,
  []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      canvasRef.current?.resizePreservingView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [leftCollapsed, rightCollapsed]);

  useEffect(() => () => externalDragCleanupRef.current?.(), []);

  const handleBlockPointerDragStart = (request: BlockPointerDragStart): void => {
    externalDragCleanupRef.current?.();
    let moved = false;
    const move = (event: PointerEvent): void => {
      if (event.pointerId !== request.pointerId) return;
      if (Math.hypot(
        event.clientX - request.clientPoint.clientX,
        event.clientY - request.clientPoint.clientY,
      ) >= 6) {
        moved = true;
        setBlockDragPreview({
          blockType: request.blockType,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }
    };
    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== request.pointerId) return;
      const bounds = canvasStageRef.current?.getBoundingClientRect();
      if (
        moved &&
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
      setBlockDragPreview(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (externalDragCleanupRef.current === cleanup) {
        externalDragCleanupRef.current = null;
      }
    };
    externalDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const runCommand = (id: WorkbenchCommandId): void => {
    switch (id) {
      case "file.new":
        void documentSession.newDocument();
        break;
      case "file.open":
        void documentSession.openDocument();
        break;
      case "file.save":
        void documentSession.saveDocument();
        break;
      case "file.saveAs":
        void documentSession.saveDocumentAs();
        break;
      case "file.exit":
        void documentSession.requestClose();
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
        setHelpView("quickStart");
        break;
      case "help.shortcuts":
        setHelpView("shortcuts");
        break;
      case "help.about":
        setHelpView("about");
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
        documentLabel={documentSession.label}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onInsertBlock={insertBlock}
        windowChrome={windowChrome}
        onRequestClose={documentSession.requestClose}
      />

      <main
        className={[
          "workbench",
          leftCollapsed ? "workbench--left-collapsed" : "",
          rightCollapsed ? "workbench--right-collapsed" : "",
        ].filter(Boolean).join(" ")}
      >
        {leftCollapsed ? null : (
          <div className="workbench__library">
            <BlockLibrary
              selectedCategoryId={selectedCategoryId}
              onSelectedCategoryIdChange={setSelectedCategoryId}
              onInsert={(request) => insertBlock(request.blockType)}
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
            onProjection={acceptProjection}
            onViewStateChange={setCanvasView}
          />
          <CanvasToolControls
            tool={canvasView.tool}
            onToolChange={(nextTool) => canvasRef.current?.setTool(nextTool)}
          />
          <CanvasControls
            zoomPercent={canvasView.zoomPercent}
            onSave={() => void documentSession.saveDocument()}
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
          {documentSession.operationError ? (
            <p className="app-operation-error" role="alert">
              {documentSession.operationError}
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
              onClick={() => setActiveTab("builder")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveTab("builder");
                }
              }}
            >
              搭建助手
            </button>
            <button
              id="runtime-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === "runtime"}
              aria-controls="runtime-panel"
              onClick={() => setActiveTab("runtime")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveTab("runtime");
                }
              }}
            >
              对话测试
            </button>
          </div>

          <div className="assistant-panel__body">
            <div
              id="builder-panel"
              role="tabpanel"
              aria-labelledby="builder-tab"
              hidden={activeTab !== "builder"}
            >
                <BuilderAssistant
                  hasAgent={hasAgent}
                  hasChatEntry={hasChatBlock}
                  onAddAgent={() => void insertBlock("core.agent.define")}
                  onAddChatEntry={() => void insertBlock("core.interaction.chat_entry")}
                  onOpenQuickStart={() => runCommand("help.quickStart")}
                />
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
                  submissions={controller.submissions}
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
      {documentSession.pendingIntent ? (
        <UnsavedChangesDialog
          documentName={documentSession.state.displayName}
          onDecision={(decision) => void documentSession.resolveUnsavedDecision(decision)}
        />
      ) : null}
      {helpView ? (
        <HelpDialog view={helpView} onClose={() => setHelpView(null)} />
      ) : null}
      {blockDragPreview ? (
        <div
          className="block-drag-preview"
          data-testid="block-drag-preview"
          aria-hidden="true"
          style={{
            left: blockDragPreview.clientX,
            top: blockDragPreview.clientY,
          }}
        >
          <span className="sr-only">
            {getBlockDisplayName(blockDragPreview.blockType)}
          </span>
          <BlockPreview blockType={blockDragPreview.blockType} />
        </div>
      ) : null}
    </div>
  );
}
