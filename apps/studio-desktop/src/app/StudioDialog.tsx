import { useState, type Dispatch, type SetStateAction } from "react";
import { catalog } from "@blocky/block-catalog";
import { commands } from "@blocky/command-system";
import type { Studio } from "../composition/useStudio";
import { SettingsPanel } from "./SettingsPanel";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { ResourcePanel } from "./ResourcePanel";
import type { ConstructionKind } from "./ConstructionDialog";
import type { MenuCategory } from "./MenuBar";
import type { SourceRef } from "@blocky/language-schema";
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
}) {
  const [note, setNote] = useState("");
  return (
    <div
      className="popup-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setPopup(null);
      }}
    >
      <section
        className={`popup ${popup.kind === "context" ? "context-popup" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          popup.kind === "settings"
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
        <header>
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
        </header>
        {popup.kind === "annotation" ? (
          <form onSubmit={(event) => {
            event.preventDefault();
            s.applySelectionEdit({ kind: "annotate", note });
            setPopup(null);
          }}>
            <label>注释<textarea aria-label="积木注释" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <button type="submit" disabled={!s.selectedRoots.length}>保存注释</button>
          </form>
        ) : popup.kind === "resources" ? (
          <ResourcePanel studio={s} />
        ) : popup.kind === "shortcuts" ? (
          <ShortcutsPanel studio={s} />
        ) : popup.kind === "about" ? (
          <div className="settings">
            <h2>Blocky Studio</h2>
            <p>用积木搭建、运行和分享你的创作。</p>
            <p>版本 0.2.0</p>
          </div>
        ) : popup.kind === "settings" ? (
          <SettingsPanel studio={s} />
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
