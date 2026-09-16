import { expect, test } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { ProjectController } from "../src/controller";
import * as modules from "../src/modules";
import { compileProject } from "../../compiler/src/index";

test("module creation, rename and deletion are stable project transactions", async () => {
  const controller = new ProjectController(createStarter());
  controller.edit((p) => modules.createModule(p, "extra-module", "新画布"));
  expect(
    controller.getSnapshot().project.workspaces["extra-module"].blocks.blocks,
  ).toEqual([]);
  controller.undo();
  expect(controller.getSnapshot().project.workspaces).not.toHaveProperty(
    "extra-module",
  );
  controller.redo();
  controller.edit((p) => modules.renameModule(p, "citation-service", "新名字"));
  expect(
    (await compileProject(controller.getSnapshot().project)).diagnostics,
  ).toEqual([]);
  controller.edit((p) => modules.deleteModule(p, "citation-service"));
  expect(
    (await compileProject(controller.getSnapshot().project)).diagnostics.map(
      (d) => d.code,
    ),
  ).toContain("BLK-LINK-001");
  controller.undo();
  expect(
    (await compileProject(controller.getSnapshot().project)).diagnostics,
  ).toEqual([]);
});

test("invalid names, duplicate IDs and removing the last canvas preserve the project", () => {
  const controller = new ProjectController(createStarter());
  const before = controller.getSnapshot();
  expect(() =>
    controller.edit((p) =>
      modules.createModule(p, "research-agent", "duplicate"),
    ),
  ).toThrow();
  expect(() =>
    controller.edit((p) => modules.renameModule(p, "research-agent", "")),
  ).toThrow();
  expect(controller.getSnapshot()).toBe(before);
  controller.edit((p) => modules.deleteModule(p, "citation-service"));
  expect(() =>
    controller.edit((p) => modules.deleteModule(p, "research-agent")),
  ).toThrow();
});
