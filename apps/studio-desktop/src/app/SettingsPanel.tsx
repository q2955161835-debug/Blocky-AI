import { useState, useEffect } from "react";
import { searchSettings, resolveSetting } from "@blocky/settings-core";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { Studio } from "../composition/useStudio";
function NumericSetting({
  title,
  value,
  disabled,
  change,
}: {
  title: string;
  value: number;
  disabled: boolean;
  change(value: number): void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      aria-label={title}
      type="number"
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => change(text.trim() ? Number(text) : NaN)}
    />
  );
}
export function SettingsPanel({ studio: s }: { studio: Studio }) {
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState<"app" | "project">("app"),
    [error, setError] = useState("");
  const models = [...s.resources.map.values()].filter(isUserOnlineModel);
  const change = (id: string, value: unknown, reset = false) => {
    try {
      s.settings.change(scope, id, value, reset);
      setError("");
    } catch {
      setError("设置值或作用域无效，原值保持不变。");
    }
  };
  return (
    <div className="settings settings-panel">
      <button onClick={s.resetLayout}>恢复默认工作台布局</button>
      <input
        aria-label="搜索设置"
        placeholder="搜索设置…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <label>
        保存位置{" "}
        <select
          aria-label="设置作用域"
          value={scope}
          onChange={(e) => setScope(e.target.value as "app" | "project")}
        >
          <option value="app">应用</option>
          <option value="project">当前项目</option>
        </select>
      </label>
      {(s.settings.error || error) && (
        <p role="alert">{s.settings.error || error}</p>
      )}
      {s.settings.error && (
        <button
          onClick={() =>
            void s
              .confirm("恢复默认将替换损坏的应用设置。继续？")
              .then((yes) => yes && s.settings.recover())
          }
        >
          恢复应用默认值
        </button>
      )}
      {searchSettings(query).map((def) => {
        const resolved = resolveSetting(def.id, s.settings.layers),
          disabled = !s.settings.ready || !def.allowedScopes.includes(scope);
        return (
          <section className="setting-row" key={def.id}>
            <label>
              {def.title}
              {def.valueType === "boolean" ? (
                <input
                  aria-label={def.title}
                  type="checkbox"
                  disabled={disabled}
                  checked={resolved.value === true}
                  onChange={(e) => change(def.id, e.target.checked)}
                />
              ) : def.valueType === "model-resource" ? (
                <select aria-label={def.title} value={String(resolved.value)} disabled={disabled || !s.resources.ready}
                  onChange={(e) => change(def.id, e.target.value)}>
                  <option value="">使用本地默认</option>
                  {resolved.value && !models.some(model => model.resourceId === resolved.value) &&
                    <option value={String(resolved.value)} disabled>默认模型不可用</option>}
                  {models.map(model => <option key={model.resourceId} value={model.resourceId}>{model.displayName}</option>)}
                </select>
              ) : def.valueType === "enum" ? (
                <select
                  aria-label={def.title}
                  value={String(resolved.value)}
                  disabled={disabled}
                  onChange={(e) => change(def.id, e.target.value)}
                >
                  <option value="professional">专业</option>
                  <option value="beginner">入门</option>
                </select>
              ) : (
                <NumericSetting
                  title={def.title}
                  disabled={disabled}
                  value={Number(resolved.value)}
                  change={(value) => change(def.id, value)}
                />
              )}
            </label>
            <small>
              {def.description} · 来源：
              {
                {
                  app: "应用",
                  project: "项目",
                  resource: "资源",
                  block: "积木",
                  default: "默认",
                }[resolved.source]
              }
            </small>
            <button
              disabled={disabled}
              onClick={() => change(def.id, null, true)}
            >
              恢复继承
            </button>
          </section>
        );
      })}
      {!query && (
        <>
          <h3>工作台布局</h3>
          <label>
            左侧积木库宽度
            <input
              type="range"
              min="180"
              max="1200"
              value={s.session.leftWidth}
              onChange={(e) =>
                s.setSession((v) => ({
                  ...v,
                  leftWidth: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            右侧面板宽度
            <input
              type="range"
              min="240"
              max="1200"
              value={s.session.rightWidth}
              onChange={(e) =>
                s.setSession((v) => ({
                  ...v,
                  rightWidth: Number(e.target.value),
                }))
              }
            />
          </label>
        </>
      )}
    </div>
  );
}
