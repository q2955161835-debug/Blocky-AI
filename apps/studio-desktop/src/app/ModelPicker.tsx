import type { Resource } from "@blocky/language-schema";
export function ModelPicker({
  label,
  value,
  models,
  disabled,
  change,
  context,
}: {
  label: string;
  value: string;
  models: Resource[];
  disabled: boolean;
  change(id: string): void;
  context?: string;
}) {
  const selected = models.find((model) => model.resourceId === value);
  return (
    <select
      className="chat-model-picker"
      aria-label={label}
      title={`${context ? context + " · " : ""}${selected?.displayName ?? "选择模型"}`}
      value={value}
      disabled={disabled}
      onChange={(event) => change(event.target.value)}
    >
      {!value && (
        <option value="" disabled>
          选择模型
        </option>
      )}
      {value && !selected && (
        <option value={value} disabled>
          模型不可用
        </option>
      )}
      {models.map((model) => (
        <option
          key={`${model.scope}/${model.resourceId}`}
          value={model.resourceId}
        >
          {model.displayName}
        </option>
      ))}
    </select>
  );
}
