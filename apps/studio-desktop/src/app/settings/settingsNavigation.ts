export type SettingsSection =
  | "general"
  | "appearance"
  | "models"
  | "builder"
  | "agent"
  | "shortcuts"
  | "advanced";

export const settingsSections = [
  { id: "general", title: "常规" },
  { id: "appearance", title: "外观" },
  { id: "models", title: "模型与厂商" },
  { id: "builder", title: "构建助手" },
  { id: "agent", title: "作品运行" },
  { id: "shortcuts", title: "快捷键" },
  { id: "advanced", title: "专业" },
] as const satisfies readonly { id: SettingsSection; title: string }[];
