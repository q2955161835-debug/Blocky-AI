import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { ProjectController } from "../src/controller";
import { configureBlock } from "../src/configure";
it("shares field editing, rejects undeclared fields and preserves one-step undo", () => {
  const c = new ProjectController(createStarter());
  c.edit((p) =>
    configureBlock(p, "research-agent", "research-root", "ROLE", "科学教师"),
  );
  expect(
    c.getSnapshot().project.workspaces["research-agent"].blocks.blocks[0]
      .fields!.ROLE,
  ).toBe("科学教师");
  expect(() =>
    c.edit((p) =>
      configureBlock(
        p,
        "research-agent",
        "research-root",
        "API_KEY",
        "FICTIONAL",
      ),
    ),
  ).toThrow("BLK-CONFIG-001");
  c.undo();
  expect(c.getSnapshot().dirty).toBe(false);
});
