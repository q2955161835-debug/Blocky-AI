import { useState } from "react";
import { commands, shortcut } from "@blocky/command-system";
import type { Studio } from "../composition/useStudio";
export function ShortcutsPanel({ studio: s }: { studio: Studio }) {
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const change = (id: string, keys: string[] | undefined) => {
    try {
      s.shortcuts.change(id, keys);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "快捷键无效");
    }
  };
  return (
    <section className="settings">
      <input
        aria-label="搜索快捷键"
        placeholder="搜索命令或按键…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {(error || s.shortcuts.error) && (
        <p role="alert">{error || s.shortcuts.error}</p>
      )}
      {s.shortcuts.error && (
        <button onClick={s.shortcuts.recover}>恢复默认快捷键</button>
      )}
      {commands
        .filter((c) =>
          `${c.label} ${c.commandId} ${s.shortcuts.keys(c.commandId).join(" ")}`.includes(
            query,
          ),
        )
        .map((c) => (
          <label key={c.commandId}>
            {c.label}
            <input
              aria-label={`${c.label}快捷键`}
              readOnly
              disabled={!s.shortcuts.ready}
              value={s.shortcuts.keys(c.commandId).join(" / ")}
              placeholder="聚焦后按下组合键"
              onKeyDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (
                  ["Control", "Shift", "Alt", "Meta"].includes(e.key) ||
                  e.nativeEvent.isComposing
                )
                  return;
                change(c.commandId, [shortcut(e)]);
              }}
            />
            <button
              disabled={!s.shortcuts.ready}
              onClick={() => change(c.commandId, [])}
            >
              清除
            </button>
            <button
              disabled={!s.shortcuts.ready}
              onClick={() => change(c.commandId, undefined)}
            >
              默认
            </button>
          </label>
        ))}
    </section>
  );
}
