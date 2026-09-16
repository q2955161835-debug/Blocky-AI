import type { Project } from "@blocky/language-schema";
export type Session = {
  tabs: string[];
  active: string;
  panel: boolean;
  view: "problems" | "logs" | "terminal" | "output";
  height: number;
};
export function restoreSession(project: Project, input: unknown): Session {
  const ids = project.manifest.modules.map((m) => m.moduleId);
  const raw = (
    input && typeof input === "object" ? input : {}
  ) as Partial<Session>;
  const tabs = Array.isArray(raw.tabs)
    ? [...new Set(raw.tabs.filter((id) => ids.includes(id)))]
    : ids;
  return {
    tabs,
    active:
      typeof raw.active === "string" && tabs.includes(raw.active)
        ? raw.active
        : (tabs[0] ?? ""),
    panel: raw.panel !== false,
    view: ["problems", "logs", "terminal", "output"].includes(raw.view ?? "")
      ? raw.view!
      : "problems",
    height: Math.max(
      120,
      Math.min(480, Number.isFinite(raw.height) ? raw.height! : 210),
    ),
  };
}
