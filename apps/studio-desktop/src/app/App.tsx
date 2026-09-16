import { Welcome } from "./Welcome";
import { Library } from "./Library";
import { StudioDialog, type Popup } from "./StudioDialog";
import { useEffect, useRef, useState } from "react";
import { commands, shortcut } from "@blocky/command-system";
import { Canvas, type CanvasHandle } from "@blocky/ui-editor";
import { useStudio } from "../composition/useStudio";
import { Inspector } from "./Inspector";
import { RunPanel } from "./RunPanel";
import { BottomPanel } from "./BottomPanel";
import { ConfirmationDialog } from "./ConfirmationDialog";
export function App() {
  const s = useStudio(),
    api = useRef<CanvasHandle | null>(null);
  const [popup, setPopup] = useState<Popup>(null),
    [query, setQuery] = useState("");
  const show = (kind: NonNullable<Popup>["kind"]) => {
    setQuery("");
    setPopup({ kind });
  };
  const actions: Record<string, () => void> = {
    "file.new": s.fresh,
    "file.open": () => void s.open(),
    "file.save": () => void s.save(),
    "edit.undo": () => s.controller.undo(),
    "edit.redo": () => s.controller.redo(),
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
  };
  const enabled = (id: string) =>
    !s.confirmation &&
    !!actions[id] &&
    !(s.busy && id.startsWith("file.")) &&
    !(s.running && (id === "file.new" || id === "file.open")) &&
    (id !== "edit.undo" || s.snapshot.canUndo) &&
    (id !== "edit.redo" || s.snapshot.canRedo) &&
    (id !== "run.start" || (s.started && s.canRun)) &&
    (id !== "run.stop" || s.running) &&
    (id !== "view.back" || s.canGoBack);
  const execute = (id: string) => {
    setPopup(null);
    if (enabled(id)) actions[id]();
  };
  const latest = useRef({ execute, popup });
  latest.current = { execute, popup };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && latest.current.popup) {
        setPopup(null);
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        show("commands");
        return;
      }
      const input =
        e.target instanceof HTMLElement &&
        e.target.matches("input,textarea,select");
      const command = commands.find((c) =>
        c.defaultShortcuts.includes(shortcut(e)),
      );
      if (command && (!input || !command.commandId.startsWith("edit."))) {
        e.preventDefault();
        latest.current.execute(command.commandId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <main className="studio">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => s.setStarted(false)}
          aria-label="返回开始页"
        >
          <span className="brand-mark">B</span>
          <strong>
            Blocky <span>Studio</span>
          </strong>
        </button>
        <nav>
          {[
            ["file", "文件"],
            ["edit", "编辑"],
            ["view", "视图"],
            ["run", "运行"],
          ].map(([cat, label]) => (
            <button
              key={cat}
              onClick={() => {
                setQuery(cat);
                setPopup({ kind: "commands" });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="command-search" onClick={() => show("commands")}>
          ⌕ 搜索命令 <kbd>Ctrl ⇧ P</kbd>
        </button>
        <span className="spacer" />
        <button onClick={() => show("settings")} aria-label="打开设置">
          ⚙
        </button>
      </header>
      {!s.started ? (
        <Welcome studio={s} />
      ) : (
        <>
          <div className="project-toolbar">
            <div>
              <strong>{s.snapshot.project.manifest.displayName}</strong>
              {s.snapshot.dirty && (
                <span className="dirty" title="未保存">
                  ●
                </span>
              )}
              <span className="project-count">
                {s.snapshot.project.manifest.modules.length} 个画布
              </span>
            </div>
            <span className="spacer" />
            <button disabled={s.busy} onClick={() => void s.save()}>
              保存
            </button>
            <button
              disabled={!s.snapshot.canUndo}
              onClick={() => s.controller.undo()}
              aria-label="撤销"
            >
              ↶
            </button>
            <button
              disabled={!s.snapshot.canRedo}
              onClick={() => s.controller.redo()}
              aria-label="重做"
            >
              ↷
            </button>
            <button
              className="primary"
              onClick={() => void s.run()}
              disabled={!enabled("run.start")}
            >
              ▶ 运行
            </button>
          </div>
          <div className="workbench">
            <Library
              studio={s}
              search={() => show("blocks")}
              add={(type) => api.current?.add(type)}
            />
            <section className="workspace">
              <div className="workspace-tabs">
                {s.session.tabs.map((id) => {
                  const m = s.snapshot.project.manifest.modules.find(
                    (m) => m.moduleId === id,
                  );
                  return (
                    m && (
                      <div
                        key={id}
                        className={id === s.session.active ? "active" : ""}
                      >
                        <button
                          onClick={() =>
                            s.setSession((v) => ({ ...v, active: id }))
                          }
                        >
                          ▧ {m.displayName}
                        </button>
                        <button
                          aria-label={`关闭 ${m.displayName}`}
                          onClick={() =>
                            s.setSession((v) => {
                              const tabs = v.tabs.filter((t) => t !== id);
                              const viewports = { ...v.viewports };
                              delete viewports[id];
                              return {
                                ...v,
                                tabs,
                                viewports,
                                active:
                                  v.active === id ? (tabs[0] ?? "") : v.active,
                              };
                            })
                          }
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
                        s.controller.edit((p) => {
                          p.manifest.modules.find(
                            (m) => m.moduleId === s.session.active,
                          )!.displayName = e.target.value;
                        })
                      }
                    />
                    <span className="spacer" />
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
                    onSearch={() => show("blocks")}
                    onContext={(x, y) => setPopup({ kind: "context", x, y })}
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
                <div className="empty-canvas">
                  从左侧项目画布列表重新打开画布。
                </div>
              )}
              <BottomPanel studio={s} />
            </section>
            <aside className="right-sidebar">
              <RunPanel studio={s} />
              <Inspector studio={s} />
            </aside>
          </div>
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
          answer={s.answerConfirmation}
        />
      )}
      {popup && !s.confirmation && (
        <StudioDialog
          studio={s}
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
