import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { createRecovery, readRecovery } from "../src/index";
import { ProjectController } from "@blocky/project-model";
it("restores only a verified unsaved copy and preserves the need to save", async () => {
  const original = createStarter();
  const record = await createRecovery(original);
  const recovered = await readRecovery(JSON.parse(JSON.stringify(record)));
  expect(recovered.project).toEqual(original);
  const controller = new ProjectController(createStarter());
  controller.recover(recovered.project);
  expect(controller.getSnapshot().dirty).toBe(true);
  expect(controller.getSnapshot().canUndo).toBe(false);
  const corrupt = structuredClone(record);
  corrupt.files["project.json"] += " ";
  await expect(readRecovery(corrupt)).rejects.toThrow("BLK-RECOVERY-001");
});
