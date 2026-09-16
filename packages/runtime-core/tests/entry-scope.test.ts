import { expect, it } from "vitest";
import { Runtime } from "../src";
import { createStarter } from "../../test-fixtures/src";

it("requires module scope for colliding entry IDs and executes the requested module", async () => {
  const p = createStarter();
  p.manifest.modules.push({
    ...p.manifest.modules[0],
    moduleId: "teacher-agent",
    workspaceRef: "modules/teacher-agent/workspace.json",
  });
  p.workspaces["teacher-agent"] = structuredClone(
    p.workspaces["research-agent"],
  );
  p.workspaces["teacher-agent"].blocks.blocks[0].fields!.ROLE = "科学教师";
  const runtime = new Runtime();
  const ambiguous = await runtime.run(p, "on-question", "水循环");
  expect(ambiguous.status).toBe("failed");
  expect(ambiguous.events.some((e) => e.type === "block.started")).toBe(false);
  const selected = await runtime.run(p, "on-question", "水循环", {
    moduleId: "teacher-agent",
  });
  expect(selected.status).toBe("completed");
  expect(
    selected.events.some(
      (e) => e.moduleId === "teacher-agent" && e.blockId === "research-root",
    ),
  ).toBe(true);
  expect(selected.events.some((e) => e.moduleId === "research-agent")).toBe(
    false,
  );
  const missing = await runtime.run(p, "on-question", "水循环", {
    moduleId: "missing",
  });
  expect(missing.status).toBe("failed");
});
