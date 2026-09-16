import type { Project } from "@blocky/language-schema";
export type CanvasViewport = {
  offsetX: number;
  offsetY: number;
  scale: number;
};
export type Session = {
  tabs: string[];
  active: string;
  panel: boolean;
  view: "problems" | "logs" | "terminal" | "output";
  height: number;
  viewports: Record<string, CanvasViewport>;
};
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
function viewport(v: unknown): CanvasViewport | undefined {
  const p = object(v);
  if (
    ![p.offsetX, p.offsetY, p.scale].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  )
    return;
  return {
    offsetX: Math.max(-100000, Math.min(100000, p.offsetX as number)),
    offsetY: Math.max(-100000, Math.min(100000, p.offsetY as number)),
    scale: Math.max(0.35, Math.min(1.8, p.scale as number)),
  };
}
export function restoreSession(project: Project, input: unknown): Session {
  const ids = project.manifest.modules.map((m) => m.moduleId);
  let raw = object(input);
  if (raw.schemaVersion !== undefined) {
    if (
      raw.schemaVersion !== "blocky.workspace-session/v1alpha1" ||
      raw.projectId !== project.manifest.projectId
    )
      raw = {};
    else {
      const tabs = (Array.isArray(raw.openTabs) ? raw.openTabs : [])
        .map(object)
        .filter(
          (t) =>
            t.kind === "canvas" &&
            typeof t.targetId === "string" &&
            ids.includes(t.targetId),
        )
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const panel = object(raw.bottomPanel);
      const views = (Array.isArray(raw.canvasViews) ? raw.canvasViews : []).map(
        object,
      );
      raw = {
        tabs: tabs.map((t) => t.targetId),
        active: tabs.find((t) => t.tabId === raw.activeTabId)?.targetId,
        panel: panel.visible,
        view: panel.activeView === "run-log" ? "logs" : panel.activeView,
        height: panel.heightPx,
        viewports: Object.fromEntries(
          tabs.map((t) => [
            t.targetId,
            views.find((v) => v.tabId === t.tabId)?.viewport,
          ]),
        ),
      };
    }
  }
  const tabs = Array.isArray(raw.tabs)
    ? [
        ...new Set(
          raw.tabs.filter(
            (id): id is string => typeof id === "string" && ids.includes(id),
          ),
        ),
      ]
    : ids;
  return {
    tabs,
    active:
      typeof raw.active === "string" && tabs.includes(raw.active)
        ? raw.active
        : (tabs[0] ?? ""),
    panel: raw.panel !== false,
    view: ["problems", "logs", "terminal", "output"].includes(String(raw.view))
      ? (raw.view as Session["view"])
      : "problems",
    height: Math.max(
      120,
      Math.min(
        480,
        typeof raw.height === "number" && Number.isFinite(raw.height)
          ? raw.height
          : 210,
      ),
    ),
    viewports: Object.fromEntries(
      tabs.flatMap((id) => {
        const v = viewport(object(raw.viewports)[id]);
        return v ? [[id, v]] : [];
      }),
    ),
  };
}
export function serializeSession(project: Project, session: Session) {
  const s = restoreSession(project, session);
  return {
    schemaVersion: "blocky.workspace-session/v1alpha1" as const,
    projectId: project.manifest.projectId,
    openTabs: s.tabs.map((id, order) => ({
      tabId: `tab-${id}`,
      kind: "canvas" as const,
      targetId: id,
      order,
    })),
    ...(s.active ? { activeTabId: `tab-${s.active}` } : {}),
    bottomPanel: {
      visible: s.panel,
      activeView: s.view === "logs" ? "run-log" : s.view,
      heightPx: s.height,
      maximized: false,
      filters: {},
    },
    canvasViews: Object.entries(s.viewports).map(([id, v]) => ({
      tabId: `tab-${id}`,
      viewport: v,
    })),
    browserViews: [],
    terminalLayout: { direction: "single", sessionIds: [] },
  };
}
