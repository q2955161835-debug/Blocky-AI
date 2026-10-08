import { useState, type Dispatch, type SetStateAction } from "react";
import { catalog } from "@blocky/block-catalog";
import { commands } from "@blocky/command-system";
import type { Studio } from "../composition/useStudio";
import { SettingsPanel } from "./SettingsPanel";
import type { ConstructionKind } from "./ConstructionDialog";
import type { MenuCategory } from "./MenuBar";
import type { SourceRef } from "@blocky/language-schema";
import type {CodingAgent} from "../composition/useCodingAgent";
import type {SettingsSection} from "./settings/settingsNavigation";
export type Popup =
  | {
      kind:
        | "commands"
        | "blocks"
        | "settings"
        | "shortcuts"
        | "resources"
        | "annotation"
        | "about"
        | "rpa"
        | ConstructionKind;
      x?: number;
      y?: number;
      section?: SettingsSection;
    }
  | { kind: "context"; scope: "blank" | "block" | "multi" | "library" | "event"; x: number; y: number; blockType?: string; blockId?: string; source?: SourceRef }
  | { kind: "menu"; category: MenuCategory }
  | { kind: "chat"; menu: "add" | "settings" | "history" }
  | null;
export function StudioDialog({
  studio: s,
  popup,
  setPopup,
  query,
  setQuery,
  actions,
  enabled,
  execute,
  add,
  builder,
}: {
  studio: Studio;
  popup: Exclude<NonNullable<Popup>, { kind: "menu" | "chat" }>;
  setPopup: Dispatch<SetStateAction<Popup>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  actions: Record<string, () => void>;
  enabled(id: string): boolean;
  execute(id: string): void;
  add(type: string): void;
  builder?:CodingAgent;
}) {
  const [note, setNote] = useState("");
  const isSettings=["settings","resources","shortcuts"].includes(popup.kind);
  const [dirty,setDirty]=useState(false),[closeWarning,setCloseWarning]=useState(false),[closeError,setCloseError]=useState("");
  const close=async()=>{
    if(isSettings&&dirty){setCloseWarning(true);return;}
    try{if(isSettings){await s.settings.flush();await s.resources.flush();}setPopup(null);}
    catch{setCloseError("设置尚未保存，请重试后关闭。");}
  };
  return (
    <div
      className="popup-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) void close();
      }}
      onKeyDownCapture={e=>{if(isSettings&&e.key==="Escape"){e.preventDefault();e.stopPropagation();void close();}}}
    >
      <section
        className={`popup ${popup.kind === "context" ? "context-popup" : ""} ${isSettings?"unified-settings-popup":""}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          isSettings
            ? "设置"
            : popup.kind === "resources"
              ? "资源管理"
              : popup.kind === "blocks"
                ? "搜索积木"
                : popup.kind === "annotation"
                  ? "积木注释"
                  : popup.kind === "context"
                    ? "上下文菜单"
                  : "命令中心"
        }
        style={
          popup.kind === "context"
            ? {
                left: Math.max(8, Math.min(popup.x ?? 0, window.innerWidth - 360)),
                top: Math.max(8, Math.min(popup.y ?? 0, window.innerHeight - 360)),
                maxHeight: window.innerHeight - Math.max(8, Math.min(popup.y ?? 0, window.innerHeight - 360)) - 8,
              }
            : undefined
        }
      >
        {!isSettings&&<header>
          <strong>
            {popup.kind === "settings"
              ? "设置"
              : popup.kind === "resources"
                ? "资源管理"
                : popup.kind === "blocks"
                  ? "搜索积木"
                  : popup.kind === "annotation"
                    ? "积木注释"
                    : popup.kind === "context"
                      ? "上下文菜单"
                    : "命令中心"}
          </strong>
          <button onClick={() => setPopup(null)} aria-label="关闭弹层">
            ×
          </button>
        </header>}
        {isSettings?<>
          <SettingsPanel studio={s} builder={builder} initialSection={popup.kind==="resources"?"models":popup.kind==="shortcuts"?"shortcuts":("section" in popup?popup.section:undefined)} execute={execute} enabled={enabled} onClose={()=>void close()} onDirty={setDirty}/>
          {(closeWarning||closeError)&&<div className="settings-close-warning" role="alert">{closeError||"当前配置有未保存的草稿。"}{closeWarning&&<><button onClick={()=>setCloseWarning(false)}>返回编辑</button><button onClick={()=>setPopup(null)}>舍弃草稿并关闭</button></>}</div>}
        </>:popup.kind === "annotation" ? (
          <form onSubmit={(event) => {
            event.preventDefault();
            s.applySelectionEdit({ kind: "annotate", note });
            setPopup(null);
          }}>
            <label>注释<textarea aria-label="积木注释" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <button type="submit" disabled={!s.selectedRoots.length}>保存注释</button>
          </form>
        ) : popup.kind === "about" ? (
          <div className="settings">
            <h2>Blocky Studio</h2>
            <p>用积木搭建、运行和分享你的创作。</p>
            <p>版本 0.2.0</p>
          </div>
        ) : (
          <>
            <input
              autoFocus
              aria-label={popup.kind === "blocks" ? "积木搜索词" : "命令搜索词"}
              placeholder={popup.kind === "blocks" ? "搜索积木…" : "搜索命令…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="popup-list">
              {popup.kind === "blocks"
                ? catalog
                    .filter(
                      (b) => b.label.includes(query) || b.type.includes(query),
                    )
                    .map((b) => (
                      <button
                        key={b.type}
                        onClick={() => {
                          add(b.type);
                          setPopup(null);
                        }}
                      >
                        <span style={{ color: b.color }}>■</span>
                        {b.label}
                      </button>
                    ))
                : commands
                    .filter(
                      (c) =>
                        actions[c.commandId] &&
                        (popup.kind === "context" ? c.contexts.includes(popup.scope) : c.contexts.includes("studio")) &&
                        (c.label.includes(query) ||
                          c.category === query ||
                          c.commandId.includes(query)),
                    )
                    .map((c) => (
                      <button
                        key={c.commandId}
                        disabled={!enabled(c.commandId)}
                        title={
                          enabled(c.commandId)
                            ? undefined
                            : "当前状态或选择不适用"
                        }
                        onClick={() => execute(c.commandId)}
                      >
                        {c.label}
                        <kbd>{s.shortcuts.keys(c.commandId)[0]}</kbd>
                      </button>
                    ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
