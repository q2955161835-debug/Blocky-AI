import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { encodeProject, decodeProject } from "../src/index";
it("round trips declared project facts in independent files", () => {
  const p = createStarter();
  const files = encodeProject(p);
  expect(Object.keys(files)).toContain("project.json");
  expect(Object.keys(files)).toContain(
    "workspaces/research-agent.workspace.json",
  );
  expect(decodeProject(files)).toEqual(p);
  expect(Object.keys(files).some((k) => /session|log|history/.test(k))).toBe(
    false,
  );
});
it("rejects missing workspace data, traversal names and undeclared files", () => {
  const files = encodeProject(createStarter());
  delete files["workspaces/research-agent.workspace.json"];
  expect(() => decodeProject(files)).toThrow();
  expect(() =>
    decodeProject({ ...encodeProject(createStarter()), "../private": "{}" }),
  ).toThrow();
  expect(() =>
    decodeProject({ ...encodeProject(createStarter()), "session.json": "{}" }),
  ).toThrow();
});
