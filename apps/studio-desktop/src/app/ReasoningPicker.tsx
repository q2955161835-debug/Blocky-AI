import type { Resource } from "@blocky/language-schema";
import { getReasoningLevels } from "@blocky/resource-registry";
type ReasoningEffort = "none" | "low" | "high" | "max";
const titles: Record<ReasoningEffort, string> = {
  none: "思考：关闭",
  low: "思考：低",
  high: "思考：高",
  max: "思考：最大",
};
export function ReasoningPicker({
  label,
  value,
  model,
  disabled,
  change,
}: {
  label: string;
  value: ReasoningEffort;
  model?: Resource;
  disabled: boolean;
  change(value: ReasoningEffort): void;
}) {
  const levels = model ? getReasoningLevels(model) : (["none"] as const);
  const supported = levels.includes(value);
  return (
    <select
      className="chat-reasoning-picker"
      aria-label={label}
      title={levels.length === 1 ? "当前模型不支持可选思考等级" : label}
      value={value}
      disabled={disabled || (levels.length === 1 && value === "none")}
      onChange={(event) => change(event.target.value as ReasoningEffort)}
    >
      {!supported && (
        <option value={value} disabled>
          {titles[value]}（不可用）
        </option>
      )}
      {levels.map((level) => (
        <option key={level} value={level}>
          {titles[level]}
        </option>
      ))}
    </select>
  );
}
