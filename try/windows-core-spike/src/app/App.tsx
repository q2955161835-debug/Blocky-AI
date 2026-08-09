import { useRef, useState } from "react";
import blockyLogoUrl from "../../../../logo/logo.png";
import {
  BlocklyCanvas,
  type BlocklyCanvasHandle,
} from "../blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../blockly/fixtures";
import { BuilderPlaceholder } from "../builder/BuilderPlaceholder";
import type { JsonValue } from "../core/json";
import type { RuntimeDependencies } from "../core/deterministicRuntime";
import type { HostBridge } from "../host/HostBridge";
import { RuntimePanel } from "../runtime/RuntimePanel";
import { useSpikeController } from "./useSpikeController";
import "./app.css";

export interface AppProps {
  hostBridge: HostBridge;
  initialWorkspace?: JsonValue;
  projectId?: string;
  runtimeModel?: RuntimeDependencies["model"];
  canvasAction?: CanvasAction;
}

export interface CanvasAction {
  readonly ariaLabel: string;
  readonly label: string;
  run(): void;
}

const EMPTY_WORKSPACE: JsonValue = {
  blocks: { blocks: [], languageVersion: 0 },
};

export function App({
  hostBridge,
  initialWorkspace = EMPTY_WORKSPACE,
  projectId = "windows-core-spike",
  runtimeModel,
  canvasAction,
}: AppProps) {
  const canvasRef = useRef<BlocklyCanvasHandle>(null);
  const [activeTab, setActiveTab] = useState<"builder" | "runtime">("runtime");
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

  return (
    <div className="app-shell">
      <header className="app-chrome">
        <div className="app-brand">
          <img src={blockyLogoUrl} alt="" />
          <strong>Blocky</strong>
        </div>
        <div className="app-actions" aria-label="项目操作">
          <button
            type="button"
            onClick={() => canvasRef.current?.load(createHundredBlockWorkspaceState())}
          >
            载入100块
          </button>
          <button type="button" onClick={() => canvasRef.current?.load(EMPTY_WORKSPACE)}>
            清空
          </button>
          {canvasAction ? (
            <button
              type="button"
              aria-label={canvasAction.ariaLabel}
              onClick={canvasAction.run}
            >
              {canvasAction.label}
            </button>
          ) : null}
          <button type="button" onClick={() => void controller.saveProject()}>
            保存
          </button>
          <button type="button" onClick={() => void controller.loadProject()}>
            重开
          </button>
        </div>
        {controller.operationError ? (
          <p className="app-operation-error" role="alert">
            {controller.operationError}
          </p>
        ) : null}
      </header>

      <main className="editor-grid">
        <span className="sr-only">Blocky Windows 核心尖峰</span>
        <section className="editor-workspace">
          <header className="library-heading">
            <h1>本地积木库</h1>
            <span>31 个尖峰块</span>
          </header>
          <header className="canvas-heading">
            <h1>Blockly 画布</h1>
          </header>
          <div className="editor-workspace__surface">
            <BlocklyCanvas
              ref={canvasRef}
              initialState={initialWorkspace}
              onProjection={controller.acceptProjection}
            />
            <div className="canvas-zoom" aria-label="画布缩放">
              <button
                type="button"
                aria-label="放大画布"
                onClick={() => canvasRef.current?.zoomIn()}
              >
                放大
              </button>
              <button
                type="button"
                aria-label="缩小画布"
                onClick={() => canvasRef.current?.zoomOut()}
              >
                缩小
              </button>
            </div>
          </div>
        </section>

        <aside className="assistant-panel">
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
                disabled={controller.runtime.status === "running" || hasCompileError}
                running={controller.runtime.status === "running"}
                pendingPermission={controller.pendingPermission}
                onCancel={controller.cancelRun}
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
