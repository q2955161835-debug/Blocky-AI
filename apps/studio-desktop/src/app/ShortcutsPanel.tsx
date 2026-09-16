import { useState } from "react";
import { commands, shortcut, shortcutNotice } from "@blocky/command-system";
import type { Studio } from "../composition/useStudio";
export function ShortcutsPanel({ studio: s }: { studio: Studio }) {
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [config, setConfig] = useState("");
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
      <details>
        <summary>导入与导出配置</summary>
        <textarea
          aria-label="快捷键 JSON 配置"
          value={config}
          onChange={(e) => setConfig(e.target.value)}
        />
        <button
          disabled={!s.shortcuts.ready}
          onClick={() => setConfig(s.shortcuts.exportConfig())}
        >
          生成导出配置
        </button>
        <button
          disabled={!s.shortcuts.ready}
          onClick={() => {
            try {
              s.shortcuts.importConfig(config);
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "配置无效");
            }
          }}
        >
          合并导入配置
        </button>
      </details>
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
            {shortcutNotice(s.shortcuts.keys(c.commandId)) && (
              <small>{shortcutNotice(s.shortcuts.keys(c.commandId))}</small>
            )}
            {[0, 1].map((slot) => (
              <input
                key={slot}
                aria-label={`${c.label}${slot ? "备用" : "主"}快捷键`}
                readOnly
                disabled={!s.shortcuts.ready}
                value={s.shortcuts.keys(c.commandId)[slot] ?? ""}
                placeholder="聚焦后按下组合键"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (
                    ["Control", "Shift", "Alt", "Meta"].includes(e.key) ||
                    e.nativeEvent.isComposing
                  )
                    return;
                  const keys = [...s.shortcuts.keys(c.commandId)];
                  keys[slot] = shortcut(e);
                  change(c.commandId, keys.filter(Boolean));
                }}
              />
            ))}
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
