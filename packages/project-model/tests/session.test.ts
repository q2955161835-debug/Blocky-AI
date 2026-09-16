import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { restoreSession, serializeSession } from "../src/session";
import {
  activateTab,
  closeTab,
  restoreTab,
  cycleTab,
  moveTab,
} from "../src/tabs";
it("restores closed tabs, MRU and panel layout as session-only data", () => {
  const p = createStarter(),
    before = JSON.stringify(p);
  let s = restoreSession(p, null);
  s = activateTab(s, "citation-service");
  s = closeTab(s);
  expect(s.closedTabs).toEqual(["citation-service"]);
  s = restoreTab(
    s,
    p.manifest.modules.map((m) => m.moduleId),
  );
  s = moveTab(s, -1);
  expect(s.tabs[0]).toBe("citation-service");
  expect(cycleTab(s, 1).active).toBe("research-agent");
  s.maximized = true;
  s.dock = "right";
  s.width = 420;
  s.leftWidth = 245;
  s.rightWidth = 320;
  const saved = serializeSession(p, s);
  expect(restoreSession(p, saved)).toMatchObject({
    maximized: true,
    dock: "right",
    width: 420,
    leftWidth: 245,
    rightWidth: 320,
    recentTabs: s.recentTabs,
  });
  expect(JSON.stringify(p)).toBe(before);
});
it("reports rejected session versions and removed targets without persisting diagnostics", () => {
  const p = createStarter();
  expect(
    restoreSession(p, { schemaVersion: "unknown" }).diagnostics[0],
  ).toMatchObject({ severity: "info", code: "BLK-SESSION-001" });
  const recovered = restoreSession(p, { tabs: ["missing"], active: "missing" });
  expect(recovered.tabs).toEqual(["research-agent"]);
  expect(recovered.diagnostics[0]).toMatchObject({
    severity: "info",
    code: "BLK-SESSION-002",
  });
  expect(serializeSession(p, recovered)).not.toHaveProperty("diagnostics");
  expect(restoreSession(p, { tabs: [], active: "" }).tabs).toEqual([]);
});
it("removes stale tabs without changing project or allowing invalid layout", () => {
  const p = createStarter();
  const before = JSON.stringify(p);
  const s = restoreSession(p, {
    tabs: ["missing", "citation-service", "citation-service"],
    active: "missing",
    height: -5,
  });
  expect(s.tabs).toEqual(["citation-service"]);
  expect(s.active).toBe("citation-service");
  expect(s.height).toBe(120);
  expect(JSON.stringify(p)).toBe(before);
});
it("persists the versioned contract, drops closed viewport state and rejects another project's session", () => {
  const p = createStarter();
  const session = restoreSession(p, null);
  session.tabs = ["citation-service"];
  session.active = "citation-service";
  session.view = "logs";
  session.viewports = {
    "citation-service": { offsetX: 80, offsetY: -30, scale: 1.3 },
    "research-agent": { offsetX: 20, offsetY: 30, scale: 0.5 },
  };
  const saved = serializeSession(p, session);
  expect(saved.schemaVersion).toBe("blocky.workspace-session/v1alpha1");
  expect(saved.bottomPanel.activeView).toBe("run-log");
  expect(saved.canvasViews).toHaveLength(1);
  expect(restoreSession(p, saved)).toMatchObject({
    active: "citation-service",
    view: "logs",
    viewports: { "citation-service": session.viewports["citation-service"] },
  });
  expect(
    restoreSession(p, { ...saved, projectId: "other-project" }).tabs,
  ).toHaveLength(2);
  expect(
    restoreSession(p, { ...saved, schemaVersion: "unknown" }).tabs,
  ).toHaveLength(2);
});
