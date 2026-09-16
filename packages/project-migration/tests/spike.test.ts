import { expect, test } from "vitest";
import source from "../fixtures/spike-text.json";
import { migrateProject } from "../src/index";
import { Runtime } from "../../runtime-core/src/runtime";
const files = () => ({
  "manifest.json": JSON.stringify({ formatVersion: "blocky.document/v1" }),
  "project.json": JSON.stringify(source),
});
test("explicit spike migration preserves all six IDs, layout, value and executable reply", async () => {
  const input = files(),
    before = JSON.stringify(input);
  const result = await migrateProject(input);
  expect(result.diagnostics).toEqual([]);
  expect(result.project!.workspaces.main).toEqual(source.workspace);
  const run = await new Runtime().run(
    result.project!,
    "entry-one",
    "irrelevant",
    { moduleId: "main" },
  );
  expect(run.status).toBe("completed");
  expect(run.answer).toBe('{"value":[1,"原作品文本"]}');
  expect(JSON.stringify(input)).toBe(before);
  expect(await migrateProject(input)).toEqual(result);
});
test("spike derived tampering and same-name incompatible knowledge block cannot become a current project", async () => {
  const tampered = structuredClone(source);
  tampered.program.roots = [];
  expect(
    (
      await migrateProject({
        ...files(),
        "project.json": JSON.stringify(tampered),
      })
    ).diagnostics[0].code,
  ).toBe("BLK-MIG-004");
  const unsupported = structuredClone(source);
  unsupported.workspace.blocks.blocks[0].type = "core.knowledge.retrieve";
  const result = await migrateProject({
    ...files(),
    "project.json": JSON.stringify(unsupported),
  });
  expect(result.project).toBeUndefined();
  expect(result.diagnostics[0]).toMatchObject({
    code: "BLK-MIG-002",
    source: { blockId: "agent-one" },
  });
});
