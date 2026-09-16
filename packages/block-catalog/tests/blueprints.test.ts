import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { ProjectController } from "../../project-model/src";
import {
  captureBlueprint,
  instantiateBlueprint,
  defaultBindings,
  parseBlueprint,
} from "../src/blueprints";

it("captures real stacks with explicit dependency slots and reinserts fresh IDs in one undo", async () => {
  const p = createStarter();
  const workspace = p.workspaces["research-agent"];
  workspace.blocks.blocks.push({
    type: "core.output.answer",
    id: "second-output",
    fields: { STYLE: "段落" },
    x: 380,
    y: 170,
  });
  const blueprint = await captureBlueprint(
    p,
    "research-agent",
    ["research-root", "second-output"],
    "我的问答",
    "blueprint-one",
  );
  expect(blueprint.resources).toHaveLength(1);
  expect(blueprint.modules).toHaveLength(1);
  expect(JSON.stringify(blueprint)).not.toContain("handbook-access");
  const controller = new ProjectController(p);
  const before = JSON.stringify(controller.getSnapshot().project);
  let serial = 0;
  const roots = await instantiateBlueprint(
    blueprint,
    p,
    "research-agent",
    defaultBindings(blueprint),
    { x: 500, y: 300 },
    () => `inserted-${++serial}`,
  );
  expect(roots.map((b) => [b.x, b.y])).toEqual([
    [500, 300],
    [800, 400],
  ]);
  expect(roots[0].id).not.toBe("research-root");
  controller.edit((draft) =>
    draft.workspaces["research-agent"].blocks.blocks.push(...roots),
  );
  controller.undo();
  expect(JSON.stringify(controller.getSnapshot().project)).toBe(before);
  await expect(
    instantiateBlueprint(blueprint, p, "research-agent", {
      resources: {},
      modules: {},
    }),
  ).rejects.toThrow("BLK-BLUEPRINT-002");
});
it("rejects tampered content, absent dependencies, unsafe fields and non-top-level selections", async () => {
  const p = createStarter();
  await expect(
    captureBlueprint(
      p,
      "research-agent",
      ["on-question"],
      "bad",
      "blueprint-bad",
    ),
  ).rejects.toThrow("BLK-BLUEPRINT-001");
  const blueprint = await captureBlueprint(
    p,
    "research-agent",
    ["research-root"],
    "safe",
    "blueprint-safe",
  );
  const altered = structuredClone(blueprint);
  altered.roots[0].fields!.ROLE = "changed";
  await expect(parseBlueprint(altered)).rejects.toThrow("BLK-BLUEPRINT-003");
  await expect(
    instantiateBlueprint(
      blueprint,
      p,
      "research-agent",
      defaultBindings(blueprint),
      { x: 0, y: 0 },
      () => "research-root",
    ),
  ).rejects.toThrow("BLK-BLUEPRINT-004");
  p.workspaces["research-agent"].blocks.blocks[0].fields!.TOKEN =
    "fictional-sensitive-marker";
  await expect(
    captureBlueprint(
      p,
      "research-agent",
      ["research-root"],
      "bad",
      "blueprint-bad",
    ),
  ).rejects.toThrow("BLK-BLUEPRINT-001");
});
