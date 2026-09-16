import {
  diagnostic,
  type Diagnostic,
  type Project,
} from "@blocky/language-schema";
export type CanvasViewport = {
  offsetX: number;
  offsetY: number;
  scale: number;
};
export type Session = {
  diagnostics: Diagnostic[];
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
  const canvasIds = project.manifest.modules.map((m) => m.moduleId);
  const surfaceIds = project.manifest.appSurfaces.map((s) => s.surfaceId);
  const ids = [...canvasIds, ...surfaceIds.map((id) => `surface:${id}`)];
  const key = (t: Record<string, unknown>) =>
    t.kind === "browser" ? `surface:${t.targetId}` : String(t.targetId);
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, message: string) =>
    diagnostics.push({
      ...diagnostic(code, message, { projectId: project.manifest.projectId }),
      severity: "info",
    });
  let removedTargets = false;
  let raw = object(input);
  if (raw.schemaVersion !== undefined) {
    if (
      raw.schemaVersion !== "blocky.workspace-session/v1alpha1" ||
      raw.projectId !== project.manifest.projectId
    ) {
      report(
        "BLK-SESSION-001",
        "未读取不兼容或其他项目的会话，已恢复默认布局。请重新打开需要的画布。",
      );
      raw = {};
    } else {
      const allTabs = (Array.isArray(raw.openTabs) ? raw.openTabs : []).map(
        object,
      );
      const tabs = allTabs
        .filter(
          (t) =>
            typeof t.targetId === "string" &&
            ((t.kind === "canvas" && canvasIds.includes(t.targetId)) ||
              (t.kind === "browser" && surfaceIds.includes(t.targetId))),
        )
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      removedTargets = tabs.length !== allTabs.length;
      const panel = object(raw.bottomPanel);
      const views = (Array.isArray(raw.canvasViews) ? raw.canvasViews : []).map(
        object,
      );
      raw = {
        tabs: tabs.map(key),
        active: tabs.filter((t) => t.tabId === raw.activeTabId).map(key)[0],
        panel: panel.visible,
        view: panel.activeView === "run-log" ? "logs" : panel.activeView,
        height: panel.heightPx,
        viewports: Object.fromEntries(
          tabs
            .filter((t) => t.kind === "canvas")
            .map((t) => [
              t.targetId,
              views.find((v) => v.tabId === t.tabId)?.viewport,
            ]),
        ),
      };
    }
  }
  let tabs = Array.isArray(raw.tabs)
    ? [
        ...new Set(
          raw.tabs.filter(
            (id): id is string => typeof id === "string" && ids.includes(id),
          ),
        ),
      ]
    : canvasIds;
  removedTargets ||=
    Array.isArray(raw.tabs) &&
    raw.tabs.some((id) => typeof id !== "string" || !ids.includes(id));
  if (removedTargets) {
    report(
      "BLK-SESSION-002",
      "已跳过不存在或不支持的会话标签。可从项目画布列表重新打开画布。",
    );
    if (!tabs.length && ids.length) tabs = [ids[0]];
  }
  return {
    diagnostics,
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
      tabs
        .filter((id) => canvasIds.includes(id))
        .flatMap((id) => {
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
      tabId: `tab-${id.replace(":", "-")}`,
      kind: id.startsWith("surface:")
        ? ("browser" as const)
        : ("canvas" as const),
      targetId: id.startsWith("surface:") ? id.slice(8) : id,
      order,
    })),
    ...(s.active ? { activeTabId: `tab-${s.active.replace(":", "-")}` } : {}),
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
