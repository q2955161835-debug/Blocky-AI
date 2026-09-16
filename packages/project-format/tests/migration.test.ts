import { expect, test } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { encodeProject, decodeProject } from "../src/index";
import * as migration from "../../project-migration/src/index";

test("old formal archives require explicit migration, preserve facts and never mutate input", async () => {
  const expected = createStarter();
  const files = encodeProject(expected);
  const manifest = JSON.parse(files["project.json"]);
  manifest.schemaVersion = "blocky.project/v1alpha1";
  files["project.json"] = JSON.stringify(manifest);
  const before = JSON.stringify(files);
  expect(() => decodeProject(files)).toThrow("BLK-MIG-001");
  const result = await migration.migrateProject(files);
  expect(result.diagnostics).toEqual([]);
  expect(result.project).toEqual(expected);
  expect(JSON.stringify(files)).toBe(before);
  expect(await migration.migrateProject(files)).toEqual(result);
});

test("migration rejects future versions and unsupported blocks with source diagnostics", async () => {
  const files = encodeProject(createStarter());
  const manifest = JSON.parse(files["project.json"]);
  manifest.schemaVersion = "blocky.project/v7";
  files["project.json"] = JSON.stringify(manifest);
  expect((await migration.migrateProject(files)).project).toBeUndefined();
  manifest.schemaVersion = "blocky.project/v1alpha1";
  files["project.json"] = JSON.stringify(manifest);
  const path = manifest.modules[0].workspaceRef;
  const workspace = JSON.parse(files[path]);
  workspace.blocks.blocks[0].type = "unknown.block";
  files[path] = JSON.stringify(workspace);
  const rejected = await migration.migrateProject(files);
  expect(rejected.project).toBeUndefined();
  expect(
    rejected.diagnostics.some((d) => d.source?.blockId === "research-root"),
  ).toBe(true);
});
