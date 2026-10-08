export type UiPreferences = {
  permissionMode: "full" | "ask";
  theme: "dark" | "light" | "system";
  fontSize: number;
  fontFamily: "system" | "yahei" | "simsun";
  codeFont: "consolas" | "courier" | "system";
  builderModelId: string;
  agentModelId: string;
  agentReasoningEffort: "none" | "low" | "high" | "max";
  builderReasoningEffort: "none" | "low" | "high" | "max";
};
export type UiPreferenceId = keyof UiPreferences;
export const defaultUiPreferences: UiPreferences = {
  permissionMode: "full",
  theme: "dark",
  fontSize: 13,
  fontFamily: "yahei",
  codeFont: "consolas",
  builderModelId: "",
  agentModelId: "",
  agentReasoningEffort: "none",
  builderReasoningEffort: "none",
};
export type UiPreferencesDocument = {
  schemaVersion: "blocky.ui-preferences/v1";
  values: Partial<UiPreferences>;
};
export function parseUiPreferences(raw: unknown): UiPreferencesDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("BLK-UI-PREFERENCES");
  const doc = raw as Record<string, unknown>;
  if (
    doc.schemaVersion !== "blocky.ui-preferences/v1" ||
    Object.keys(doc).some((k) => !["schemaVersion", "values"].includes(k)) ||
    !doc.values ||
    typeof doc.values !== "object" ||
    Array.isArray(doc.values)
  )
    throw Error("BLK-UI-PREFERENCES");
  const values: Partial<UiPreferences> = {};
  for (const [id, value] of Object.entries(doc.values)) {
    const valid =
      id === "permissionMode"
        ? value === "full" || value === "ask"
        : id === "fontSize"
        ? typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 11 &&
          value <= 24
        : id === "builderModelId" || id === "agentModelId"
          ? typeof value === "string" &&
            (value === "" ||
              (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) &&
                !/^sk-/i.test(value) &&
                !["__proto__", "prototype", "constructor"].includes(value)))
          : id === "agentReasoningEffort" || id === "builderReasoningEffort"
            ? typeof value === "string" &&
              ["none", "low", "high", "max"].includes(value)
            : typeof value === "string" &&
              (id === "theme"
                ? ["dark", "light", "system"]
                : id === "fontFamily"
                  ? ["system", "yahei", "simsun"]
                  : id === "codeFont"
                    ? ["consolas", "courier", "system"]
                    : []
              ).includes(value);
    if (!valid) throw Error("BLK-UI-PREFERENCES");
    Object.assign(values, { [id]: value });
  }
  return { schemaVersion: "blocky.ui-preferences/v1", values };
}
