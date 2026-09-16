import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { restoreSession } from "../src/session";
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
