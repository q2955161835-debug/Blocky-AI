import { useCallback, useState } from "react";
import type { Resource } from "@blocky/language-schema";
import { resourceDefinitions } from "@blocky/resource-registry";
import { ManagedModelPanel, localRuntimeError } from "./ManagedModelPanel";

const modelDefinition = resourceDefinitions.find(({ kind }) => kind === "model")!;
const modelProperties = modelDefinition.definitionSchema.properties!;
const timeoutMsMaximum = modelProperties.timeoutMs.maximum!;
const maxOutputTokensMaximum =
  modelProperties.parameters.properties!.maxOutputTokens.maximum!;

const presets = [
  { id: "deepseek", title: "DeepSeek", modelId: "deepseek-chat" },
  { id: "xirang", title: "息壤", modelId: "deepseek-v4-pro" },
  { id: "openai-compatible", title: "自定义兼容服务", modelId: "" },
  { id: "ollama", title: "Ollama", modelId: "" },
  { id: "managed-local", title: "本机托管 Qwen", modelId: "qwen3-0.6b-q8-v1" },
] as const;
const capabilities = [
  ["text", "文本"],
  ["tools", "工具调用"],
  ["structured-output", "结构化输出"],
] as const;
const managedCapabilities: readonly string[] = [
  "text",
  "tools",
  "structured-output",
];
function preset(resource: Resource) {
  const ref = resource.definition.implementationRef;
  return presets.find(
    (p) =>
      resource.definition.provider === p.id &&
      typeof ref === "object" &&
      ref !== null &&
      !Array.isArray(ref) &&
      ref.kind === "adapter" &&
      ref.id === `${p.id}-v1`,
  );
}

export function modelSecretFields(resource: Resource): readonly string[] {
  const type = preset(resource)?.id;
  if (type === "managed-local") return [];
  if (type === "deepseek" || type === "xirang") return ["apiKey"];
  return ["baseUrl", "apiKey", "headers"];
}

/** Visible form errors supplement the shared resource validator; advanced profiles retain their existing contract. */
export function modelResourceError(resource: Resource): string {
  const type = preset(resource)?.id;
  if (!type) return "";
  const d = resource.definition;
  if (resource.scope !== "user")
    return "模型服务需要本机用户资源范围，请重新选择服务类型。";
  if (typeof d.modelId !== "string" || !d.modelId.trim())
    return "模型 ID 不能为空。";
  if (
    typeof d.timeoutMs !== "number" ||
    !Number.isInteger(d.timeoutMs) ||
    d.timeoutMs < 1 ||
    d.timeoutMs > timeoutMsMaximum
  )
    return `超时须为 1–${timeoutMsMaximum} 毫秒的整数。`;
  const params = d.parameters;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    if (
      params.temperature !== undefined &&
      (typeof params.temperature !== "number" ||
        !Number.isFinite(params.temperature) ||
        params.temperature < 0 ||
        params.temperature > 2)
    )
      return "温度须在 0–2 之间。";
    if (
      params.maxOutputTokens !== undefined &&
      (typeof params.maxOutputTokens !== "number" ||
        !Number.isInteger(params.maxOutputTokens) ||
        params.maxOutputTokens < 1 ||
        params.maxOutputTokens > maxOutputTokensMaximum)
    )
      return `输出上限须为 1–${maxOutputTokensMaximum} 的整数。`;
  }
  if (!Array.isArray(d.capabilities) || !d.capabilities.includes("text"))
    return "已声明能力须包含文本。";
  if (type === "managed-local") {
    const runtimeError = localRuntimeError(d.localRuntime);
    if (runtimeError) return runtimeError;
    if (resource.secretBindings.length) return "本机托管模型不能包含秘密引用。";
    if (
      d.modelId !== "qwen3-0.6b-q8-v1" ||
      d.capabilities.some((c) => !managedCapabilities.includes(String(c)))
    )
      return "本机托管 Qwen 的模型 ID 或已声明能力无效。";
  } else if (
    (type === "openai-compatible" || type === "ollama") &&
    !resource.secretBindings.some((b) => b.fieldId === "baseUrl")
  ) {
    return "请在秘密配置中添加 baseUrl 引用，并从本地配置导入端点。";
  } else if (
    (type === "deepseek" || type === "xirang") &&
    !resource.secretBindings.some((b) => b.fieldId === "apiKey")
  ) {
    return "请在秘密配置中添加 apiKey 引用，并从本地配置导入密钥。";
  }
  return "";
}

export function ModelResourceEditor({
  resource,
  change,
  onBusyChange,
}: {
  resource: Resource;
  change(resource: Resource): void;
  onBusyChange?(busy: boolean): void;
}) {
  const [selectionError, setSelectionError] = useState("");
  const [managedBusy, setManagedBusy] = useState(false);
  const busyChanged = useCallback(
    (busy: boolean) => {
      setManagedBusy(busy);
      onBusyChange?.(busy);
    },
    [onBusyChange],
  );
  const selected = preset(resource);
  const definition = resource.definition;
  const params =
    definition.parameters &&
    typeof definition.parameters === "object" &&
    !Array.isArray(definition.parameters)
      ? definition.parameters
      : {};
  const validationError = modelResourceError(resource);
  const runtimeError =
    selected?.id === "managed-local"
      ? localRuntimeError(definition.localRuntime)
      : "";
  const error =
    selectionError ||
    (runtimeError && validationError === runtimeError ? "" : validationError);
  const update = (patch: Resource["definition"]) => {
    setSelectionError("");
    change({ ...resource, definition: { ...definition, ...patch } });
  };
  const parameter = (key: string, value: string) => {
    const next = { ...params };
    if (value === "") delete next[key];
    else next[key] = Number(value);
    update({ parameters: next });
  };
  return (
    <fieldset className="model-resource-editor">
      <legend>模型配置</legend>
      <label>
        服务类型
        <select
          aria-label="模型服务类型"
          disabled={managedBusy}
          value={selected?.id ?? ""}
          onChange={(e) => {
            const next = presets.find((p) => p.id === e.target.value);
            if (!next) return;
            if (next.id === selected?.id && resource.scope === "user") return;
            if (next.id === "managed-local" && resource.secretBindings.length) {
              setSelectionError("请先移除现有秘密引用，再选择本机托管 Qwen。");
              return;
            }
            setSelectionError("");
            change({
              ...resource,
              scope: "user",
              definition: {
                provider: next.id,
                modelId: next.modelId,
                protocol: next.id === "managed-local" ? "local" : "openai-chat",
                timeoutMs: 60000,
                capabilities: [...managedCapabilities],
                parameters: { temperature: 0.7 },
                implementationRef: { kind: "adapter", id: `${next.id}-v1` },
                ...(next.id === "managed-local"
                  ? {
                      localRuntime: {
                        backend: "cpu",
                        contextTokens: 8192,
                        threads: 4,
                        memoryMb: 4096,
                      },
                    }
                  : {}),
              },
            });
          }}
        >
          {!selected && <option value="">选择服务类型（保留当前配置）</option>}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <fieldset disabled={managedBusy}>
          <legend>请求配置</legend>
          <label>
            模型 ID
            <input
              aria-label="模型 ID"
              value={String(definition.modelId ?? "")}
              readOnly={selected.id === "managed-local"}
              onChange={(e) => update({ modelId: e.target.value })}
            />
          </label>
          <label>
            超时（毫秒）
            <input
              aria-label="超时（毫秒）"
              type="number"
              min={1}
              max={timeoutMsMaximum}
              step={1}
              value={String(definition.timeoutMs ?? "")}
              onChange={(e) =>
                update({
                  timeoutMs: e.target.value === "" ? 0 : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            温度
            <input
              aria-label="温度"
              type="number"
              min={0}
              max={2}
              step="any"
              value={String(params.temperature ?? "")}
              onChange={(e) => parameter("temperature", e.target.value)}
            />
          </label>
          <label>
            输出上限
            <input
              aria-label="输出上限"
              type="number"
              min={1}
              max={maxOutputTokensMaximum}
              step={1}
              value={String(params.maxOutputTokens ?? "")}
              onChange={(e) => parameter("maxOutputTokens", e.target.value)}
            />
          </label>
          <small>留空时不设置输出上限，由模型服务自行决定。</small>
          <fieldset>
            <legend>已声明能力</legend>
            {capabilities
              .filter(
                ([id]) =>
                  selected.id !== "managed-local" ||
                  managedCapabilities.includes(id),
              )
              .map(([id, title]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    aria-label={title}
                    checked={
                      Array.isArray(definition.capabilities) &&
                      definition.capabilities.includes(id)
                    }
                    onChange={(e) => {
                      const previous = Array.isArray(definition.capabilities)
                        ? definition.capabilities
                        : [];
                      update({
                        capabilities: e.target.checked
                          ? [...previous, id]
                          : previous.filter((c) => c !== id),
                      });
                    }}
                  />
                  {title}
                </label>
              ))}
          </fieldset>
        </fieldset>
      )}
      {selected?.id === "managed-local" && (
        <ManagedModelPanel
          modelId={String(definition.modelId)}
          configuration={
            definition.localRuntime &&
            typeof definition.localRuntime === "object" &&
            !Array.isArray(definition.localRuntime)
              ? definition.localRuntime
              : undefined
          }
          change={(localRuntime) => update({ localRuntime })}
          onBusyChange={busyChanged}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
