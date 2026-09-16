import { expect, test } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import * as compiler from "../src/index";

test("current compiler emits stable v1 language artifacts", async () => {
  const project = createStarter();
  const result = await compiler.compileProject(project);
  expect(project.manifest.schemaVersion).toBe("blocky.project/v1");
  expect(result.ir.schemaVersion).toBe("blocky.project-ir/v1");
  expect(
    result.modules.every((m) => m.schemaVersion === "blocky.module-ir/v1"),
  ).toBe(true);
});

test("incremental output equals full output through edits, rename, schema changes and deletion", async () => {
  expect(compiler).toHaveProperty("IncrementalCompiler");
  const { IncrementalCompiler } = compiler as typeof compiler & {
    IncrementalCompiler: new () => {
      compile: typeof compiler.compileProject;
      stats: { compiled: string[]; reused: string[] };
    };
  };
  const engine = new IncrementalCompiler();
  const p = createStarter();
  expect(await engine.compile(p)).toEqual(await compiler.compileProject(p));
  expect(engine.stats.compiled).toHaveLength(2);
  const cached = await engine.compile(p);
  expect(engine.stats.compiled).toEqual([]);
  cached.modules[0].roots.length = 0;
  expect(await engine.compile(p)).toEqual(await compiler.compileProject(p));
  p.workspaces["research-agent"].blocks.blocks[0].fields!.ROLE = "修改角色";
  expect(await engine.compile(p)).toEqual(await compiler.compileProject(p));
  expect(engine.stats.compiled).toEqual(["research-agent"]);
  p.manifest.modules[1].displayName = "新名称";
  expect(await engine.compile(p)).toEqual(await compiler.compileProject(p));
  p.schemas["schemas/citations.json"] = { type: "string" };
  expect(await engine.compile(p)).toEqual(await compiler.compileProject(p));
  p.manifest.modules.pop();
  delete p.workspaces["citation-service"];
  const missing = await engine.compile(p);
  expect(missing).toEqual(await compiler.compileProject(p));
  expect(missing.diagnostics.some((d) => d.code === "BLK-LINK-001")).toBe(true);
  expect(missing.ir.links).toEqual([]);
});
