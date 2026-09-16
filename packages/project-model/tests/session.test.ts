import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { restoreSession, serializeSession } from "../src/session";
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
