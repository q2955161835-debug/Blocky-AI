import { useEffect, useState } from "react";
import {
  resolveSetting,
  settingDefinitions,
  type SettingId,
} from "@blocky/settings-core";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { Studio } from "../../composition/useStudio";
import { SettingsRow } from "./SettingsRow";
export function NumericPreference({
  title,
  value,
  disabled,
  change,
  min,
  max,
}: {
  title: string;
  value: number;
  disabled: boolean;
  change(value: number): void;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      aria-label={title}
      type="number"
      min={min}
      max={max}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        change(text.trim() ? Number(text) : NaN);
        setText(String(value));
      }}
    />
  );
}
export function PreferenceRows({
  studio: s,
  ids,
}: {
  studio: Studio;
  ids: SettingId[];
}) {
  const [scope, setScope] = useState<"app" | "project">("app"),
    [error, setError] = useState("");
  const models = [...s.resources.map.values()].filter(isUserOnlineModel);
  const change = (id: SettingId, value: unknown, reset = false) => {
    try {
      s.settings.change(scope, id, value, reset);
      setError("");
      if (scope === "project") void s.save();
    } catch {
      setError("设置值或作用域无效，原值保持不变。");
    }
  };
  return (
    <>
      {ids.includes("terminal.outputBudgetBytes") && (
        <SettingsRow title="保存位置">
          <select
            aria-label="设置作用域"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="app">应用</option>
            <option value="project">当前项目</option>
          </select>
        </SettingsRow>
      )}
      {settingDefinitions
        .filter((def) => ids.includes(def.id))
        .map((def) => {
          const resolved = resolveSetting(def.id, s.settings.layers),
            disabled = !s.settings.ready || !def.allowedScopes.includes(scope);
          const description =
            def.id === "terminal.outputBudgetBytes"
              ? `${def.description}；新终端有效范围 4 KiB–4 MiB`
              : def.id === "logs.maxStoredBytes"
                ? `${def.description}；同时受 100000 条记录和约 195 MiB 存储上限约束`
                : def.description;
          return (
            <SettingsRow
              key={def.id}
              title={def.title}
              description={description}
            >
              {def.valueType === "boolean" ? (
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={def.title}
                  checked={resolved.value === true}
                  disabled={disabled}
                  onChange={(e) => change(def.id, e.target.checked)}
                />
              ) : def.valueType === "number" ? (
                <NumericPreference
                  title={def.title}
                  value={Number(resolved.value)}
                  disabled={disabled}
                  change={(value) => change(def.id, value)}
                />
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
                <select
                  aria-label={def.title}
                  value={String(resolved.value)}
                  disabled={disabled || !s.resources.ready}
                  onChange={(e) => change(def.id, e.target.value)}
                >
                  <option value="">使用本地默认</option>
                  {resolved.value &&
                    !models.some((m) => m.resourceId === resolved.value) && (
                      <option value={String(resolved.value)} disabled>
                        默认模型不可用
                      </option>
                    )}
                  {(s.resources.registry.providers ?? []).map((provider) => (
                    <optgroup
                      key={provider.providerId}
                      label={provider.displayName}
                    >
                      {models
                        .filter(
                          (m) =>
                            m.definition.connectionRef === provider.providerId,
                        )
                        .map((m) => (
                          <option key={m.resourceId} value={m.resourceId}>
                            {m.displayName}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                  <optgroup label="独立与本机模型">
                    {models
                      .filter((m) => !m.definition.connectionRef)
                      .map((m) => (
                        <option key={m.resourceId} value={m.resourceId}>
                          {m.displayName}
                        </option>
                      ))}
                  </optgroup>
                </select>
              )}
              <button
                disabled={disabled}
                onClick={() => change(def.id, null, true)}
              >
                恢复继承
              </button>
            </SettingsRow>
          );
        })}
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
    </>
  );
}
