import { expect, it } from "vitest";
import { digest } from "@blocky/language-schema";
import { createStarter } from "../../test-fixtures/src";
import {
  captureBlueprint,
  defaultBindings,
  instantiateBlueprint,
  migrateBlueprint,
  parseBlueprint,
  previewBlueprintUpdate,
  blueprintInstance,
} from "../src";
import { ProjectController, projectDigest } from "../../project-model/src";
import { makePatch, applyPatch } from "../../builder-protocol/src";
it("migrates an explicit v1alpha1 copy and exposes role/knowledge/tool dependencies", async () => {
  const original = await captureBlueprint(
    createStarter(),
    "research-agent",
    ["research-root"],
    "personal",
    "blueprint-study",
  );
  const { parameters: _, digest: __, ...fields } = original;
  const oldContent = { ...fields, schemaVersion: "blocky.blueprint/v1alpha1" };
  const old = { ...oldContent, digest: await digest(oldContent) },
    bytes = JSON.stringify(old);
  await expect(parseBlueprint(old)).rejects.toThrow("BLK-BLUEPRINT-001");
  const migrated = await migrateBlueprint(old);
  expect(migrated.schemaVersion).toBe("blocky.blueprint/v1");
  expect(migrated.parameters[0]).toMatchObject({
    kind: "role",
    blockId: "research-root",
  });
  expect(migrated.modules[0]).toMatchObject({
    defaultModuleId: "citation-service",
  });
  expect(migrated.migration?.sourceDigest).toBe(old.digest);
  expect(JSON.stringify(old)).toBe(bytes);
});
it("preserves user changes, surfaces conflicting updates, restores one instance and supports one undo", async () => {
  const project = createStarter();
  const v1 = await captureBlueprint(
    project,
    "research-agent",
    ["research-root"],
    "study",
    "blueprint-study",
  );
  const inserted = await instantiateBlueprint(v1, project, "research-agent", {
    ...defaultBindings(v1),
    parameters: { "role-slot-1": "用户的教师角色" },
  });
  project.workspaces["research-agent"].blocks.blocks.push(...inserted);
  const root = inserted[0];
  expect(blueprintInstance(root)?.version).toBe(1);
  const { digest: _, ...next } = structuredClone(v1);
  next.version = 2;
  next.roots[0].fields!.ROLE = "新版研究角色";
  next.parameters[0].defaultValue = "新版研究角色";
  next.roots[0].inputs!.BODY.block!.fields!.NAME = "新版问题入口";
  const v2 = await parseBlueprint({ ...next, digest: await digest(next) });
  const preview = await previewBlueprintUpdate(
    project,
    "research-agent",
    root.id,
    v2,
  );
  expect(preview.conflicts.map((c) => c.path)).toContain(
    `${root.id}/fields/ROLE`,
  );
  const kept = await previewBlueprintUpdate(
    project,
    "research-agent",
    root.id,
    v2,
    "update",
    "keep-user",
  );
  expect(kept.changes[0].after!.fields!.ROLE).toBe("用户的教师角色");
  expect(kept.changes[0].after!.inputs!.BODY.block!.fields!.NAME).toBe(
    "新版问题入口",
  );
  expect(kept.changes[0].after!.id).toBe(root.id);
  const controller = new ProjectController(project),
    before = await projectDigest(project);
  const patch = await makePatch(
    project,
    kept.changes.flatMap((c) => [
      ...(c.before
        ? [
            {
              op: "block.remove" as const,
              moduleId: "research-agent",
              blockId: c.before.id,
            },
          ]
        : []),
      ...(c.after
        ? [
            {
              op: "block.add" as const,
              moduleId: "research-agent",
              blockId: c.after.id,
              payload: c.after,
            },
          ]
        : []),
    ]),
  );
  await applyPatch(controller, patch, []);
  const updated = controller.getSnapshot().project;
  const restored = await previewBlueprintUpdate(
    updated,
    "research-agent",
    root.id,
    v2,
    "restore",
  );
  expect(restored.changes[0].after!.fields!.ROLE).toBe("新版研究角色");
  expect(
    updated.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE,
  ).toBe(project.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE);
  controller.undo();
  expect(await projectDigest(controller.getSnapshot().project)).toBe(before);
});
it("updates all roots from one captured instance and leaves another insertion alone", async () => {
  const project = createStarter();
  project.workspaces["research-agent"].blocks.blocks.push({
    type: "core.output.answer",
    id: "extra-output",
    fields: { STYLE: "段落" },
    x: 350,
    y: 150,
  });
  const blueprint = await captureBlueprint(
    project,
    "research-agent",
    ["research-root", "extra-output"],
    "two stacks",
  );
  const one = await instantiateBlueprint(
    blueprint,
    project,
    "research-agent",
    defaultBindings(blueprint),
  );
  project.workspaces["research-agent"].blocks.blocks.push(...one);
  const two = await instantiateBlueprint(
    blueprint,
    project,
    "research-agent",
    defaultBindings(blueprint),
  );
  project.workspaces["research-agent"].blocks.blocks.push(...two);
  const { digest: _, ...next } = structuredClone(blueprint);
  next.version = 2;
  next.roots[1].fields!.STYLE = "条目";
  const update = await previewBlueprintUpdate(
    project,
    "research-agent",
    one[0].id,
    { ...next, digest: await digest(next) },
  );
  expect(update.changes).toHaveLength(2);
  expect(update.changes.map((c) => c.before?.id)).toEqual(one.map((r) => r.id));
  expect(
    update.changes.some((c) => two.some((r) => r.id === c.before?.id)),
  ).toBe(false);
});
