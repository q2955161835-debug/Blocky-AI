import type { Studio } from "../composition/useStudio";
import type { CodingAgent } from "../composition/useCodingAgent";
import type { SourceRef } from "@blocky/language-schema";
import { BuilderPanel } from "./BuilderPanel";
import { RunPanel } from "./RunPanel";
import { ProjectMap } from "./ProjectMap";
import { EditorTools } from "./EditorTools";
import { Inspector } from "./Inspector";
import {
  ChatMenuButton,
  useChatMenu,
  type ChatMenuControl,
} from "./ChatControls";
import { ChatHistoryMenu } from "./ChatHistoryMenu";
import type {SettingsSection} from "./settings/settingsNavigation";

export function StudioSidebar({
  studio: s,
  builder,
  promptSuggestion,
  execute,
  enabled,
  onTraceContext,
  chatMenu,
  openSettings,
}: {
  studio: Studio;
  builder: CodingAgent;
  promptSuggestion?: { nonce: number; text: string };
  execute(id: string): void;
  enabled(id: string): boolean;
  onTraceContext(x: number, y: number, source: SourceRef): void;
  chatMenu?: ChatMenuControl;
  openSettings?(section:SettingsSection):void;
}) {
  const menu = useChatMenu(chatMenu);
  const isBuilder = s.session.rightView === "builder";
  const disabled =
    s.running ||
    s.busy ||
    s.exiting ||
    builder.busy ||
    !!s.agentChat?.switching;
  const threads = isBuilder
    ? (builder.threads ?? [])
    : (s.agentChat?.threads ?? []);
  const activeId = isBuilder ? builder.activeChatId : s.agentChat?.activeId;
  const selectChat = (id: string) =>
    isBuilder ? builder.selectChat(id) : s.changeAgentChat(id);
  const views = [
    ["agent", "Blocky Agent"],
    ["builder", "构建助手"],
  ] as const;
  const select = (rightView: "agent" | "builder") => {
    menu.set(null);
    s.setSession((current) => ({ ...current, rightView }));
  };
  return (
    <aside className="right-sidebar chat-sidebar" aria-label="右侧面板">
      <div className="chat-sidebar-header">
        <div className="sidebar-tabs" role="tablist" aria-label="右侧工具">
          {views.map(([id, label]) => (
            <button
              key={id}
              id={`sidebar-tab-${id}`}
              role="tab"
              title={label}
              aria-selected={s.session.rightView === id}
              aria-controls={`sidebar-view-${id}`}
              tabIndex={s.session.rightView === id ? 0 : -1}
              onClick={() => select(id)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
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
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-icon"
            aria-label={isBuilder ? "构建助手新会话" : "Blocky Agent 新会话"}
            title="新会话"
            disabled={
              disabled || (isBuilder ? !builder.ready : !s.agentChat?.ready)
            }
            onClick={() => {
              menu.set(null);
              void (isBuilder ? builder.newChat() : s.changeAgentChat());
            }}
          >
            ＋
          </button>
          <ChatMenuButton
            menu={menu}
            kind="history"
            label={isBuilder ? "构建助手历史会话" : "Blocky Agent 历史会话"}
          >
            ⌄
          </ChatMenuButton>
          {openSettings?<button type="button" className="chat-icon" aria-label={isBuilder ? "构建助手设置" : "Blocky Agent 设置"} title="设置" onClick={()=>{menu.set(null);openSettings(isBuilder?"builder":"agent");}}>⚙</button>:<ChatMenuButton
            menu={menu}
            kind="settings"
            label={isBuilder ? "构建助手设置" : "Blocky Agent 设置"}
          >
            ⚙
          </ChatMenuButton>}
        </div>
      </div>
      <ChatHistoryMenu
        key={`${s.snapshot.project.manifest.projectId}-${s.session.rightView}`}
        menu={menu}
        threads={threads}
        activeId={activeId ?? ""}
        select={selectChat}
        disabled={disabled}
      />
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
          menu={{ ...menu, value: !isBuilder ? menu.value : null }}
          settings={
            <>
              <ProjectMap studio={s} />
              <EditorTools studio={s} execute={execute} enabled={enabled} />
              <Inspector
                studio={s}
                configureResource={() => execute("settings.resources")}
              />
            </>
          }
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
          menu={{ ...menu, value: isBuilder ? menu.value : null }}
          promptSuggestion={promptSuggestion}
          configureModel={() => execute("settings.resources")}
          openSettings={openSettings}
        />
      </div>
    </aside>
  );
}
