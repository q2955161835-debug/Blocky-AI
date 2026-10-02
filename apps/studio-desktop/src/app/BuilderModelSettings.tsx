import { useState } from "react";
import { isUserOnlineModel } from "@blocky/resource-registry";
import type { Studio } from "../composition/useStudio";

export function BuilderModelSettings({
  studio,
  resourceId,
  disabled,
  select,
  configure,
}: {
  studio: Studio;
  resourceId: string;
  disabled: boolean;
  select(id: string): void;
  configure(): void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const models = [...studio.resources.map.values()].filter(isUserOnlineModel);
  const model = models.find((item) => item.resourceId === resourceId);
  // Persist the stored record, never the resolved view with inherited secret bindings.
  const stored = studio.resources.registry.resources.find(
    (item) => item.resourceId === resourceId,
  );
  const capabilities = model?.definition.capabilities;
  const tools = Array.isArray(capabilities) && capabilities.includes("tools");
  const enableTools = async () => {
    if (!stored || saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      const current = Array.isArray(stored.definition.capabilities)
        ? stored.definition.capabilities
        : [];
      await studio.resources.upsert({
        ...stored,
        definition: {
          ...stored.definition,
          capabilities: [...new Set([...current, "tools"])],
        },
      });
    } catch {
      setError("模型配置未能保存，请重试；原消息仍在输入框中。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="chat-model-settings">
      <label>
        模型
        <select
          aria-label="构建模型资源"
          value={resourceId}
          disabled={disabled || saving}
          onChange={(event) => {
            setError("");
            select(event.target.value);
          }}
        >
          <option value="">选择模型</option>
          {resourceId && !model && (
            <option value={resourceId}>默认模型不可用</option>
          )}
          {models.map((item) => (
            <option key={item.resourceId} value={item.resourceId}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      {!model ? (
        <p role="status">配置模型后即可发送，输入内容会保留。</p>
      ) : !tools ? (
        <>
          <p role="status">
            此模型尚未启用工具调用。若模型支持工具调用，可在这里启用后发送。
          </p>
          {stored && (
            <button
              type="button"
              disabled={disabled || saving}
              onClick={() => void enableTools()}
            >
              {saving ? "正在保存…" : "启用工具调用"}
            </button>
          )}
        </>
      ) : (
        <p className="muted">已启用工具调用</p>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={disabled || saving} onClick={configure}>
        配置模型
      </button>
    </div>
  );
}
