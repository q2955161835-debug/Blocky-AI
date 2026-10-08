import { Welcome } from "./Welcome";
import { Library } from "./Library";
import { StudioDialog, type Popup } from "./StudioDialog";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  commands,
  shortcut,
  createCommandDispatcher,
} from "@blocky/command-system";
import { activateTab, closeTab, renameModule, findBlock } from "@blocky/project-model";
import { projectCommands } from "../composition/projectCommands";
import { Canvas, type CanvasHandle } from "@blocky/ui-editor";
import { useStudio } from "../composition/useStudio";
import { BottomPanel } from "./BottomPanel";
import { ConfirmationDialog } from "./ConfirmationDialog";
import {
  ConstructionDialog,
  type ConstructionKind,
} from "./ConstructionDialog";
import { useConstruction } from "../composition/useConstruction";
import { useCodingAgent } from "../composition/useCodingAgent";
import { useTask } from "../composition/useTask";
import { useTerminals } from "../composition/useTerminals";
import { SurfacePreview } from "./SurfacePreview";
import { surfaceTitle } from "@blocky/app-surface";
import { useLogs } from "../composition/useLogs";
import { useLifecycle } from "../composition/useLifecycle";
import { ExitDialog } from "./ExitDialog";
import { MenuBar } from "./MenuBar";
import { useModalFocus } from "../composition/useModalFocus";
import { RpaPanel } from "./RpaPanel";
import { RpaInputDialog } from "./RpaInputDialog";
import { WorkbenchLayout } from "./WorkbenchLayout";
import { StudioSidebar } from "./StudioSidebar";
import { ToolbarActions } from "./ToolbarActions";
import { WindowControls } from "./WindowControls";
import { ProjectWindowMenu } from "./ProjectWindowMenu";
import logo from "../../../../logo/logo.png";
import "./Appearance.css";
export function App() {
  const s = useStudio(),
    api = useRef<CanvasHandle | null>(null);
  const currentStudio = useRef(s);
  currentStudio.current = s;
  useEffect(() => {
    if (import.meta.env.MODE !== "native-test") return;
    let active = true,
      dispose: (() => void) | undefined;
    void import("../testing/acceptance").then(({ install }) => {
      if (active) dispose = install(() => currentStudio.current);
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, []);
  const construction = useConstruction(s);
  const builder = useCodingAgent(s);
  const [builderPrompt, setBuilderPrompt] = useState<{nonce:number;text:string}>();
  const task = useTask(s);
  const terminals = useTerminals(s);
  const logs = useLogs(s),
    lifecycle = useLifecycle(s, logs, task, builder);
  const [popup, setPopup] = useState<Popup>(null),
    [query, setQuery] = useState("");
  const eventContext = popup?.kind === "context" && popup.scope === "event";
  const eventSource = eventContext ? popup.source : undefined;
  const eventWorkspace = eventSource?.projectId === s.snapshot.project.manifest.projectId && eventSource.moduleId
    ? s.snapshot.project.workspaces[eventSource.moduleId] : undefined;
  const eventBlockId = eventWorkspace && eventSource?.blockId && findBlock(eventWorkspace.blocks.blocks, eventSource.blockId)
    ? eventSource.blockId : undefined;
  const commandBlockId = eventContext ? eventBlockId
    : popup?.kind === "context" && popup.blockId ? popup.blockId : s.selected;
  const commandModuleId = eventContext ? eventSource?.moduleId : s.session.active;
  useModalFocus(
    s.rpaInput.source ? "rpa-input" : s.confirmation
      ? "confirmation"
      : lifecycle.requested
        ? "exit"
        : popup?.kind === "menu"
          ? ""
          : (popup?.kind ?? ""),
  );
  useEffect(() => {
    if (lifecycle.requested) {
      construction.conversion.cancel();
      builder.clear();
      setPopup(null);
      construction.reject();
    }
  }, [lifecycle.requested]);
  const show = (kind: Exclude<NonNullable<Popup>["kind"], "menu" | "context" | "chat">) => {
    setQuery("");
    setPopup({ kind });
  };
  const actions: Record<string, () => void> = {
    ...projectCommands(s, s.confirm),
    "view.command-center": () => show("commands"),
    "help.shortcuts": () => show("shortcuts"),
    "help.about": () => show("about"),
    "file.new": s.fresh,
    "file.open": () => void s.open(),
    "file.new-window": () => void s.newWindow(),
    "file.migrate": () => void s.migrate(),
    "file.save": () => void s.save(),
    "edit.undo": () => s.controller.undo(),
    "edit.redo": () => s.controller.redo(),
    "edit.blueprint": async () => {
      if (await construction.capture()) show("blueprint-save");
    },
    "edit.copy": () => void construction.copy(),
    "edit.duplicate": () => void construction.duplicate(),
    "edit.cut": () => void construction.copy(true),
    "edit.paste": () => {
      if (construction.clipboard) {
        construction.prepareInsert(construction.clipboard);
        show("blueprint-insert");
      }
    },
    "edit.delete": construction.remove,
    "edit.select-all": () => api.current?.selectAll(),
    "edit.clear-selection": () => api.current?.clearSelection(),
    "edit.collapse": () => api.current?.collapse(true),
    "edit.expand": () => api.current?.collapse(false),
    "edit.group": () => s.applySelectionEdit({ kind: "group", groupId: `group-${crypto.randomUUID()}`, label: "组合" }),
    "edit.ungroup": () => s.applySelectionEdit({ kind: "ungroup" }),
    "edit.region": () => s.applySelectionEdit({ kind: "group", groupId: `region-${crypto.randomUUID()}`, label: "区域", region: true }),
    "edit.annotate": () => show("annotation"),
    "edit.align-left": () => s.applySelectionEdit({ kind: "align", axis: "left" }),
    "edit.align-top": () => s.applySelectionEdit({ kind: "align", axis: "top" }),
    "edit.distribute-horizontal": () => s.applySelectionEdit({ kind: "distribute", axis: "horizontal" }),
    "edit.distribute-vertical": () => s.applySelectionEdit({ kind: "distribute", axis: "vertical" }),
    "edit.enable": () => s.applySelectionEdit({ kind: "enable", value: true }),
    "edit.disable": () => s.applySelectionEdit({ kind: "enable", value: false }),
    "build.convert": () => show("conversion"),
    "build.assistant": () => {
      s.setSession(v => ({ ...v, rightVisible: true, rightView: "builder" }));
    },
    "terminal.create": () => void terminals.create(),
    "terminal.run-task": task.start,
    "terminal.stop-task": task.cancel,
    "build.surface": () => {
      setBuilderPrompt({nonce:Date.now(),text:"为当前项目创建本地应用界面"});
      s.setSession(v => ({ ...v, rightVisible: true, rightView: "builder" }));
    },
    "terminal.stop": () => void terminals.close(),
    "window.exit": lifecycle.request,
    "run.pause": s.togglePause,
    "run.rpa": () => show("rpa"),
    "run.step": s.step,
    "run.from-selection": () => void s.runFromSelected(commandBlockId ?? undefined),
    "run.toggle-breakpoint": () => {
      if (commandBlockId && commandModuleId) s.toggleBreakpoint(commandModuleId, commandBlockId);
    },
    "edit.insert-block": () => {
      if (popup?.kind === "context" && popup.scope === "library" && popup.blockType)
        api.current?.add(popup.blockType);
    },
    "view.toggle-left-sidebar": () => s.setSession(v => ({ ...v, leftVisible: !v.leftVisible })),
    "view.toggle-right-sidebar": () => s.setSession(v => ({ ...v, rightVisible: !v.rightVisible })),
    "view.toggle-bottom-panel": () =>
      s.setSession((v) => ({ ...v, panel: !v.panel })),
    "view.show-problems": () =>
      s.setSession((v) => ({ ...v, panel: true, view: "problems" })),
    "view.show-run-log": () =>
      s.setSession((v) => ({ ...v, panel: true, view: "logs" })),
    "view.back": s.back,
    "run.start": () => void s.run(),
    "run.stop": s.stop,
    "settings.open": () => show("settings"),
    "settings.resources": () => show("resources"),
  };
  const enabled = (id: string) =>
    !s.exiting &&
    !lifecycle.requested &&
    !s.confirmation &&
    !s.rpaInput.source &&
    !construction.busy &&
    (!popup ||
      ![
        "blueprint-save",
        "blueprint-insert",
        "patch-review",
        "conversion",
        "blueprint-update",
      ].includes(popup.kind)) &&
    !!actions[id] &&
    (![
      "file.new-canvas",
      "file.save-as",
      "edit.rename-canvas",
      "edit.delete-canvas",
    ].includes(id) ||
      (s.started && !s.busy && !s.running)) &&
    (id !== "edit.delete-canvas" ||
      (s.snapshot.project.manifest.modules.length > 1 &&
        !!s.snapshot.project.workspaces[s.session.active])) &&
    (!id.startsWith("view.") || id === "view.command-center" || s.started) &&
    (id !== "view.restore-tab" || s.session.closedTabs.length > 0) &&
    (id !== "terminal.create" ||
      (s.started &&
        s.settings.ready &&
        !terminals.pending &&
        terminals.sessions.length < 8)) &&
    (id !== "terminal.stop" || !!terminals.selected) &&
    (id !== "terminal.run-task" ||
      (s.started && !s.busy && !task.active && !task.pending)) &&
    (id !== "terminal.stop-task" || task.active) &&
    (id !== "build.assistant" ||
      (s.started &&
        !s.busy &&
        !s.running &&
        !!s.snapshot.project.workspaces[s.session.active])) &&
    (id !== "build.surface" ||
      (s.started && !builder.busy &&
        !s.busy &&
        !s.running &&
        !!s.snapshot.project.workspaces[s.session.active] &&
        !s.snapshot.project.manifest.appSurfaces.length)) &&
    (![
      "edit.blueprint",
      "edit.copy",
      "edit.cut",
      "edit.delete",
      "edit.duplicate",
      "edit.collapse",
      "edit.expand",
    ].includes(id) ||
      (s.selectedRoots.length > 0 && !s.running && !s.busy)) &&
    (id !== "edit.paste" ||
      (!!construction.clipboard && !!s.session.active && !s.running)) &&
    (id !== "edit.insert-block" ||
      (popup?.kind === "context" && popup.scope === "library" && !!popup.blockType && !s.busy && !s.running)) &&
    (id !== "build.convert" ||
      (!!s.session.active && s.started && !s.busy && !s.running)) &&
    !(s.busy && id.startsWith("file.")) &&
    (id !== "file.new" || (s.settings.ready && s.resources.ready)) &&
    (id !== "file.new-window" || isTauri()) &&
    !(s.running && (id === "file.new" || id === "file.open")) &&
    (id !== "edit.undo" || s.snapshot.canUndo) &&
    (id !== "edit.redo" || s.snapshot.canRedo) &&
    (id !== "run.start" || (s.started && s.canRun)) &&
    (id !== "run.stop" || s.running) &&
    (id !== "run.pause" || s.running) &&
    (id !== "run.step" || (s.running && s.paused)) &&
    (id !== "run.from-selection" || (!!commandBlockId && s.canRun)) &&
    (id !== "run.toggle-breakpoint" || (!!commandBlockId && !s.running)) &&
    (![
      "edit.group", "edit.ungroup", "edit.region", "edit.annotate", "edit.enable", "edit.disable",
    ].includes(id) || (s.selectedRoots.length > 0 && !s.running && !s.busy)) &&
    (![
      "edit.align-left", "edit.align-top",
    ].includes(id) || (s.selectedRoots.length >= 2 && !s.running && !s.busy)) &&
    (![
      "edit.distribute-horizontal", "edit.distribute-vertical",
    ].includes(id) || (s.selectedRoots.length >= 3 && !s.running && !s.busy)) &&
    (id !== "view.back" || s.canGoBack);
  const dispatcher = createCommandDispatcher(actions, (id) =>
    enabled(id)
      ? undefined
      : s.busy
        ? "正在处理项目"
        : !s.started
          ? "请先打开项目"
          : "当前状态或选择不适用",
  );
  const execute = (id: string) => {
    setPopup(null);
    dispatcher.execute(id);
  };
  const latest = useRef({ execute, popup, running: s.running });
  latest.current = { execute, popup, running: s.running };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        e.defaultPrevented ||
        (e.target instanceof HTMLElement &&
          e.target.closest("[data-user-terminal]"))
      )
        return;
      if (
        latest.current.popup &&
        [
          "blueprint-save",
          "blueprint-insert",
          "patch-review",
          "conversion",
          "blueprint-update",
        ].includes(latest.current.popup.kind)
      )
        return;
      if (e.key === "Escape" && latest.current.popup) {
        setPopup(null);
        return;
      }
      if (e.key === "Escape" && !latest.current.running) {
        api.current?.clearSelection();
        return;
      }
      const input =
        e.target instanceof HTMLElement &&
        !!e.target.closest(
          "input,textarea,select,[contenteditable=true],[data-user-terminal]",
        );
      const command = commands.find((c) =>
        currentStudio.current.shortcuts.keys(c.commandId).includes(shortcut(e)),
      );
      if (
        command &&
        (!input ||
          ["file.save", "settings.open", "view.command-center", "run.start", "run.stop"].includes(
            command.commandId,
          ))
      ) {
        e.preventDefault();
        latest.current.execute(command.commandId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <main className="studio">
      <header className="topbar" role="banner" data-tauri-drag-region>
        <button
          className="brand"
          onClick={() => s.setStarted(false)}
          aria-label="返回开始页"
        >
          <img className="brand-mark" src={logo} alt="Blocky" draggable={false} />
          <strong>Blocky</strong>
        </button>
        <MenuBar
          active={
            popup?.kind === "menu" && !s.confirmation ? popup.category : null
          }
          open={(category) =>
            setPopup(category ? { kind: "menu", category } : null)
          }
          enabled={enabled}
          keys={s.shortcuts.keys}
          reason={(id) => dispatcher.state(id).reason}
          execute={execute}
          disabled={
            s.exiting ||
            lifecycle.requested ||
            !!s.confirmation ||
            construction.busy ||
            (!!popup &&
              [
                "blueprint-save",
                "blueprint-insert",
                "patch-review",
                "conversion",
                "blueprint-update",
              ].includes(popup.kind))
          }
        />
        {s.started && <ProjectWindowMenu title={s.snapshot.project.manifest.displayName} dirty={s.snapshot.dirty} newWindow={s.newWindow} onError={s.setMessage} />}
        <span className="spacer" data-tauri-drag-region />
        <ToolbarActions studio={s} execute={execute} enabled={enabled} />
        <WindowControls onError={s.setMessage} projectTitle={s.started ? s.snapshot.project.manifest.displayName : ""} />
      </header>
      {!s.started ? (
        <Welcome studio={s} />
      ) : !s.sessionReady ? (
        <div className="workbench-loading" role="status">正在恢复工作区…</div>
      ) : (
        <>
          <WorkbenchLayout studio={s}
            left={
            <Library
              studio={s}
              blueprints={construction.blueprints}
              construction={construction}
              update={(mode) => {
                if (construction.blueprintUpdate.prepare(mode))
                  show("blueprint-update");
              }}
              insert={(blueprint) => {
                construction.prepareInsert(blueprint);
                show("blueprint-insert");
              }}
              search={() => show("blocks")}
              add={(type) => api.current?.add(type)}
              onContext={(blockType, x, y) => setPopup({ kind: "context", scope: "library", blockType, x, y })}
            />
            }
            right={<StudioSidebar studio={s} builder={builder} promptSuggestion={builderPrompt} openSettings={section=>setPopup({kind:"settings",section})}
              chatMenu={{ value: !s.confirmation && popup?.kind === "chat" ? popup.menu : null, set: menu => setPopup(menu ? {kind:"chat",menu} : null) }}
              execute={execute} enabled={enabled}
              onTraceContext={(x, y, source) => setPopup({ kind: "context", scope: "event", x, y, source })}
              />}
          >
            <section
              className={`workspace ${s.session.dock === "right" && s.session.panel && !s.session.maximized ? "panel-right" : ""}`}
              style={
                {
                  "--panel-width": `${s.session.width}px`,
                } as React.CSSProperties
              }
            >
              <div className="workspace-tabs">
                {s.session.tabs.map((id) => {
                  const m =
                    s.snapshot.project.manifest.modules.find(
                      (m) => m.moduleId === id,
                    ) ??
                    (id.startsWith("surface:") &&
                    s.snapshot.project.manifest.appSurfaces.some(
                      (v) => v.surfaceId === id.slice(8),
                    )
                      ? {
                          displayName: surfaceTitle(
                            s.snapshot.project,
                            id.slice(8),
                          ),
                        }
                      : undefined);
                  return (
                    m && (
                      <div
                        key={id}
                        className={id === s.session.active ? "active" : ""}
                      >
                        <button
                          onClick={() =>
                            s.setSession((v) => activateTab(v, id))
                          }
                        >
                          {id.startsWith("surface:") ? "◉" : "▧"}{" "}
                          {m.displayName}
                        </button>
                        <button
                          aria-label={`关闭 ${m.displayName}`}
                          onClick={() => s.setSession((v) => closeTab(v, id))}
                        >
                          ×
                        </button>
                      </div>
                    )
                  );
                })}
              </div>
              {s.session.active &&
              s.snapshot.project.workspaces[s.session.active] ? (
                <>
                  <div className="canvas-toolbar">
                    <button
                      aria-label="返回上一位置"
                      disabled={!enabled("view.back")}
                      onClick={() => execute("view.back")}
                    >
                      ←
                    </button>
                    <input
                      aria-label="画布名称"
                      value={
                        s.snapshot.project.manifest.modules.find(
                          (m) => m.moduleId === s.session.active,
                        )?.displayName ?? ""
                      }
                      onChange={(e) =>
                        e.target.value.trim() &&
                        s.controller.edit(
                          (p) =>
                            renameModule(p, s.session.active, e.target.value),
                          `rename-${s.session.active}`,
                        )
                      }
                    />
                    <span className="spacer" />
                    {!!s.selectedRoots.length && (
                      <span>{s.selectedRoots.length} 组选中</span>
                    )}
                    <button
                      aria-label="缩小画布"
                      onClick={() => api.current?.zoom(-1)}
                    >
                      −
                    </button>
                    <button
                      aria-label="放大画布"
                      onClick={() => api.current?.zoom(1)}
                    >
                      ＋
                    </button>
                  </div>
                  <Canvas
                    key={s.session.active}
                    workspace={s.snapshot.project.workspaces[s.session.active]}
                    moduleId={s.session.active}
                    onChange={(value, group) =>
                      s.controller.edit((p) => {
                        p.workspaces[s.session.active] = value;
                      }, group)
                    }
                    onSelect={s.setSelected}
                    onSelection={s.setSelectedRoots}
                    onSearch={() => show("blocks")}
                    onContext={(x, y, scope, blockId) => {
                      s.setSelected(blockId ?? null);
                      setPopup({ kind: "context", scope, x, y, blockId });
                    }}
                    handle={(value) => {
                      api.current = value;
                    }}
                    events={s.events}
                    focusId={
                      s.focus?.moduleId === s.session.active
                        ? s.focus.blockId
                        : undefined
                    }
                    reduceMotion={s.preferences.reduceMotion}
                    viewport={s.session.viewports[s.session.active]}
                    onViewport={(value) =>
                      s.setSession((v) => {
                        const old = v.viewports[s.session.active];
                        if (
                          old?.offsetX === value.offsetX &&
                          old.offsetY === value.offsetY &&
                          old.scale === value.scale
                        )
                          return v;
                        return {
                          ...v,
                          viewports: {
                            ...v.viewports,
                            [s.session.active]: value,
                          },
                        };
                      })
                    }
                  />
                </>
              ) : (
                <div
                  className="empty-canvas"
                  hidden={s.session.active.startsWith("surface:")}
                >
                  从左侧项目画布列表重新打开画布。
                </div>
              )}
              {!s.exiting &&
                s.session.tabs
                  .filter((id) => id.startsWith("surface:"))
                  .map((id) => (
                    <SurfacePreview
                      key={`${s.snapshot.project.manifest.projectId}-${id}`}
                      studio={s}
                      surfaceId={id.slice(8)}
                      hidden={s.session.active !== id}
                    />
                  ))}
              <BottomPanel
                studio={s}
                task={task}
                logs={logs}
                terminals={terminals}
              />
            </section>
          </WorkbenchLayout>
        </>
      )}
      <footer className="statusbar">
        <span className={s.compiled?.diagnostics.length ? "warning" : ""}>
          {s.compiling
            ? "◌ 正在检查"
            : s.compiled?.diagnostics.length
              ? `⚠ ${s.compiled.diagnostics.length} 个问题`
              : "✓ 项目就绪"}
        </span>
        <span role="status">{s.message}</span>
        <span className="spacer" />
        <span>{s.running ? "● 正在运行" : "Blocky Studio"}</span>
      </footer>
      {s.confirmation && (
        <ConfirmationDialog
          message={s.confirmation}
          labels={s.confirmationLabels}
          answer={s.answerConfirmation}
        />
      )}
      {s.rpaInput.source && <RpaInputDialog key={`${s.rpaInput.source.moduleId}/${s.rpaInput.source.blockId}`} accept={s.rpaInput.answer} stop={()=>{s.stop();s.rpaInput.answer(null);}} />}
      {popup?.kind === "rpa" && !s.confirmation && <RpaPanel projectId={s.snapshot.project.manifest.projectId} close={() => setPopup(null)} draft={async(plan,url)=>{if(await construction.previewRpa(plan,url))show("patch-review");}} />}
      {lifecycle.requested && (
        <ExitDialog studio={s} lifecycle={lifecycle} logs={logs} />
      )}
      {popup &&
        [
          "blueprint-save",
          "blueprint-insert",
          "patch-review",
          "conversion",
          "blueprint-update",
        ].includes(popup.kind) &&
        !s.confirmation && (
          <ConstructionDialog
            key={popup.kind}
            studio={s}
            construction={construction}
            kind={popup.kind as ConstructionKind}
            close={() => setPopup(null)}
            showReview={() => show("patch-review")}
          />
        )}
      {popup &&
        popup.kind !== "menu" &&
        popup.kind !== "chat" &&
        popup.kind !== "rpa" &&
        ![
          "blueprint-save",
          "blueprint-insert",
          "patch-review",
          "conversion",
          "blueprint-update",
        ].includes(popup.kind) &&
        !s.confirmation && (
          <StudioDialog
            studio={s}
            builder={builder}
            popup={popup}
            setPopup={setPopup}
            query={query}
            setQuery={setQuery}
            actions={actions}
            enabled={enabled}
            execute={execute}
            add={(type) => api.current?.add(type)}
          />
        )}
    </main>
  );
}
