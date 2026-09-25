import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { ProjectController, copyAcrossModules, createModule, editSelection } from "../src";

it("edits multiple roots in one undoable transaction without changing unrelated modules", () => {
  const project = createStarter();
  const workspace = project.workspaces["research-agent"];
  workspace.blocks.blocks.push({ type: "core.agent", id: "second-root", x: 100, y: 100, fields: { ROLE: "reader" } });
  workspace.blocks.blocks[0].x = 0;
  workspace.blocks.blocks[0].y = 0;
  const controller = new ProjectController(project);
  controller.edit((p) => {
    editSelection(p.workspaces["research-agent"], ["research-root", "second-root"], { kind: "align", axis: "left" });
    editSelection(p.workspaces["research-agent"], ["research-root", "second-root"], { kind: "group", groupId: "group-one", label: "调查" });
  });
  const edited = controller.getSnapshot().project.workspaces["research-agent"].blocks.blocks;
  expect(edited.map((block) => block.x)).toEqual([0, 0]);
  expect(edited.every((block) => block.data?.includes("group-one"))).toBe(true);
  controller.undo();
  expect(controller.getSnapshot().project.workspaces["research-agent"]).toEqual(workspace);
});

it("copies stacks with fresh IDs and rejects a duplicate without partial edits", () => {
  const project = createStarter();
  createModule(project, "target-canvas", "目标画布");
  const controller = new ProjectController(project);
  let count = 0;
  controller.edit((p) => {
    copyAcrossModules(p, "research-agent", "target-canvas", ["research-root"], () => `copied-${++count}`);
  });
  const target = controller.getSnapshot().project.workspaces["target-canvas"].blocks.blocks;
  expect(target).toHaveLength(1);
  expect(target[0].id).toBe("copied-1");
  expect(target[0].inputs?.BODY.block?.id).not.toBe("on-question");
  expect(project.workspaces["target-canvas"].blocks.blocks).toHaveLength(0);
  expect(() => controller.edit((p) => copyAcrossModules(
    p, "research-agent", "target-canvas", ["research-root"], () => "copied-1",
  ))).toThrow("BLK-EDIT-003");
  expect(controller.getSnapshot().project.workspaces["target-canvas"].blocks.blocks).toEqual(target);
  controller.undo();
  expect(controller.getSnapshot().project.workspaces["target-canvas"].blocks.blocks).toHaveLength(0);
});
