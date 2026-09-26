import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { codeState, configureBlock, findBlock } from "../src";

it("shows four code states and prevents an invalid program from compiling", async () => {
  const project = createStarter();
  const block = findBlock(project.workspaces["research-agent"].blocks.blocks, "research-root");
  expect(block).toBeDefined();
  const expression = { schemaVersion: "blocky.expression/v1", parameters: ["x"], expression: { parameter: "x" } };
  const codeBlock = { type: "core.data.transform", id: "custom-expression", fields: { PROGRAM: expression } };
  project.workspaces["research-agent"].blocks.blocks.push(codeBlock);
  expect(codeState(codeBlock)).toBe("official-default");
  configureBlock(project, "research-agent", "custom-expression", "PROGRAM", JSON.stringify(expression));
  expect(codeState(codeBlock)).toBe("custom-valid");
  configureBlock(project, "research-agent", "custom-expression", "SOURCE", JSON.stringify("legacy source text"));
  expect(codeState(codeBlock)).toBe("warning");
  configureBlock(project, "research-agent", "custom-expression", "PROGRAM", JSON.stringify({ schemaVersion: "invalid" }));
  expect(codeState(codeBlock)).toBe("invalid");
  const { compileProject } = await import("../../compiler/src/index");
  expect((await compileProject(project)).diagnostics.some((item) => item.code === "BLK-EXPR-001")).toBe(true);
});
it("warns on malformed code metadata instead of treating arbitrary values as a boolean", () => {
  const program = { schemaVersion: "blocky.expression/v1", parameters: ["x"], expression: { parameter: "x" } };
  for (const codeEdited of ["false", 0, null, {}]) {
    expect(codeState({ type: "core.data.transform", id: "code", fields: { PROGRAM: program },
      data: JSON.stringify({ schemaVersion: "blocky.editor/v1", codeEdited }) })).toBe("warning");
  }
});
