import type { Dispatch, SetStateAction } from "react";
import { catalog } from "@blocky/block-catalog";
import { commands } from "@blocky/command-system";
import type { Studio } from "../composition/useStudio";
import { defaults } from "../composition/host";
import type { ConstructionKind } from "./ConstructionDialog";
export type Popup = {
  kind: "commands" | "blocks" | "settings" | "context" | ConstructionKind;
  x?: number;
  y?: number;
} | null;
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
  popup: NonNullable<Popup>;
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
              : popup.kind === "blocks"
                ? "搜索积木"
                : "命令中心"}
          </strong>
          <button onClick={() => setPopup(null)} aria-label="关闭弹层">
            ×
          </button>
        </header>
        {popup.kind === "settings" ? (
          <div className="settings">
            <p className="muted">应用设置 · 当前值保存在本机</p>
            <label>
              <input
                type="checkbox"
                checked={s.preferences.reduceMotion}
                onChange={(e) =>
                  s.setPreferences((v) => ({
                    ...v,
                    reduceMotion: e.target.checked,
                  }))
                }
              />
              减少动态效果
            </label>
            <label>
              积木库视图
              <select
                value={s.preferences.view}
                onChange={(e) =>
                  s.setPreferences((v) => ({
                    ...v,
                    view: e.target.value as "beginner" | "professional",
                  }))
                }
              >
                <option value="professional">专业</option>
                <option value="beginner">入门</option>
              </select>
            </label>
            <button onClick={() => s.setPreferences({ ...defaults })}>
              恢复应用默认值
            </button>
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
                        (c.label.includes(query) ||
                          c.category === query ||
                          c.commandId.includes(query)),
                    )
                    .map((c) => (
                      <button
                        key={c.commandId}
                        disabled={!enabled(c.commandId)}
                        onClick={() => execute(c.commandId)}
                      >
                        {c.label}
                        <kbd>{c.defaultShortcuts[0]}</kbd>
                      </button>
                    ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
