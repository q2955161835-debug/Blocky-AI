import type { Studio } from "../composition/useStudio";
import type { CodingAgent } from "../composition/useCodingAgent";
import type { SourceRef } from "@blocky/language-schema";
import { BuilderPanel } from "./BuilderPanel";
import { StarterGuide } from "./StarterGuide";
import { RunPanel } from "./RunPanel";
import { ProjectMap } from "./ProjectMap";
import { EditorTools } from "./EditorTools";
import { Inspector } from "./Inspector";
import type { ChatMenuControl } from "./ChatControls";

export function StudioSidebar({
  studio: s,
  builder,
  promptSuggestion,
  execute,
  enabled,
  onTraceContext,
  chatMenu,
}: {
  studio: Studio;
  builder: CodingAgent;
  promptSuggestion?: { nonce: number; text: string };
  execute(id: string): void;
  enabled(id: string): boolean;
  onTraceContext(x: number, y: number, source: SourceRef): void;
  chatMenu?: ChatMenuControl;
}) {
  const views = [
    ["agent", "Blocky Agent"],
    ["builder", "构建助手"],
  ] as const;
  const select = (rightView: "agent" | "builder") => {
    chatMenu?.set(null);
    s.setSession((current) => ({ ...current, rightView }));
  };
  return (
    <aside className="right-sidebar chat-sidebar" aria-label="右侧面板">
      <div className="sidebar-tabs" role="tablist" aria-label="右侧工具">
        {views.map(([id, label]) => (
          <button
            key={id}
            id={`sidebar-tab-${id}`}
            role="tab"
            aria-selected={s.session.rightView === id}
            aria-controls={`sidebar-view-${id}`}
            tabIndex={s.session.rightView === id ? 0 : -1}
            onClick={() => select(id)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "agent"
                  : event.key === "End"
                    ? "builder"
                    : id === "agent"
                      ? "builder"
                      : "agent";
              select(next);
              document.getElementById(`sidebar-tab-${next}`)?.focus();
            }}
          >
            {label}
            {id === "builder" && builder.busy && (
              <span aria-label="正在构建"> ●</span>
            )}
          </button>
        ))}
      </div>
      <div
        id="sidebar-view-agent"
        role="tabpanel"
        aria-labelledby="sidebar-tab-agent"
        hidden={s.session.rightView !== "agent"}
        className="sidebar-content"
      >
        <RunPanel
          key={s.snapshot.project.manifest.projectId}
          studio={s}
          execute={execute}
          onTraceContext={onTraceContext}
          menu={chatMenu && { ...chatMenu, value: s.session.rightView === "agent" ? chatMenu.value : null }}
          context={<StarterGuide studio={s} resources={() => execute("settings.resources")} />}
          settings={<>
            <ProjectMap studio={s} />
            <EditorTools studio={s} execute={execute} enabled={enabled} />
            <Inspector studio={s} configureResource={() => execute("settings.resources")} />
          </>}
        />
      </div>
      <div
        id="sidebar-view-builder"
        role="tabpanel"
        aria-labelledby="sidebar-tab-builder"
        hidden={s.session.rightView !== "builder"}
        className="sidebar-content"
      >
        <BuilderPanel
          key={s.snapshot.project.manifest.projectId}
          studio={s}
          builder={builder}
          menu={chatMenu && { ...chatMenu, value: s.session.rightView === "builder" ? chatMenu.value : null }}
          promptSuggestion={promptSuggestion}
          configureModel={() => execute("settings.resources")}
        />
      </div>
    </aside>
  );
}
