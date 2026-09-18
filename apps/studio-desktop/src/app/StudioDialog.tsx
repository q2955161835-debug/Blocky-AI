import type { Dispatch, SetStateAction } from "react";
import { catalog } from "@blocky/block-catalog";
import { commands } from "@blocky/command-system";
import type { Studio } from "../composition/useStudio";
import { SettingsPanel } from "./SettingsPanel";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { ResourcePanel } from "./ResourcePanel";
import type { ConstructionKind } from "./ConstructionDialog";
import type { MenuCategory } from "./MenuBar";
export type Popup =
  | {
      kind:
        | "commands"
        | "blocks"
        | "settings"
        | "shortcuts"
        | "resources"
        | "context"
        | "about"
        | ConstructionKind;
      x?: number;
      y?: number;
    }
  | { kind: "menu"; category: MenuCategory }
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
  popup: Exclude<NonNullable<Popup>, { kind: "menu" }>;
  setPopup: Dispatch<SetStateAction<Popup>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  actions: Record<string, () => void>;
  enabled(id: string): boolean;
  execute(id: string): void;
  add(type: string): void;
}) {
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
                : "命令中心"
        }
        style={
          popup.kind === "context"
            ? {
                left: Math.min(popup.x ?? 0, window.innerWidth - 360),
                top: Math.min(popup.y ?? 0, window.innerHeight - 360),
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
                  : "命令中心"}
          </strong>
          <button onClick={() => setPopup(null)} aria-label="关闭弹层">
            ×
          </button>
        </header>
        {popup.kind === "resources" ? (
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
                        (popup.kind !== "context" ||
                          c.category === "edit" ||
                          c.category === "run") &&
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
