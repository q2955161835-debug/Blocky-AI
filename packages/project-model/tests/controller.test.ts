import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { ProjectController } from "../src/controller";
it("groups an edit into a single undo step and tracks saves without masking later edits", () => {
  const p = createStarter(),
    c = new ProjectController(p);
  const before = c.getSnapshot();
  c.edit((next) => {
    next.manifest.displayName = "第一步";
  }, "drag");
  c.edit((next) => {
    next.manifest.displayName = "第二步";
  }, "drag");
  expect(c.getSnapshot().project.manifest.displayName).toBe("第二步");
  c.undo();
  expect(c.getSnapshot().project).toEqual(before.project);
  c.redo();
  expect(c.getSnapshot().project.manifest.displayName).toBe("第二步");
  const saving = c.getSnapshot().project;
  c.edit((next) => {
    next.manifest.displayName = "继续编辑";
  });
  c.markSaved(saving);
  expect(c.getSnapshot().dirty).toBe(true);
});
