import type { Resource } from "@blocky/language-schema";
export type ReasoningEffort = "none" | "low" | "high" | "max";
/** Request support is deliberately bounded to documented DeepSeek chat models. */
export function getReasoningLevels(resource: Resource | undefined): readonly ReasoningEffort[] {
  const d = resource?.definition;
  return d && ["deepseek", "xirang"].includes(String(d.provider)) && ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"].includes(String(d.modelId))
    ? ["none", "low", "high", "max"] : ["none"];
}
