import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { ProjectController, projectDigest } from "../../project-model/src";
import { makePatch, previewPatch, applyPatch } from "../src";
it("rejects untrusted diagnostic metadata and undeclared block state before preview", async () => {
  const project = createStarter();
  const patch = await makePatch(project, [
    {
      op: "block.add",
      moduleId: "research-agent",
      blockId: "safe-query",
      payload: {
        type: "core.knowledge.retrieve",
        id: "safe-query",
        fields: { RESOURCE: "product-handbook" },
      },
    },
  ]);
  await expect(
    previewPatch(project, {
      ...patch,
      diagnostics: [{ apiKey: "test-value-only" }],
    }),
  ).rejects.toThrow("BLK-PATCH-002");
  const altered = structuredClone(patch) as any;
  altered.operations[0].payload.extraState = { token: "test-value-only" };
  await expect(previewPatch(project, altered)).rejects.toThrow("BLK-PATCH-002");
});
it("rechecks the live transaction after asynchronous preview validation", async () => {
  const controller = new ProjectController(createStarter());
  const patch = await makePatch(controller.getSnapshot().project, [
    {
      op: "block.update",
      moduleId: "research-agent",
      blockId: "research-root",
      payload: { fields: { ROLE: "候选角色" } },
    },
  ]);
  const pending = applyPatch(controller, patch, []);
  controller.edit((p) => {
    p.manifest.displayName = "并发编辑";
  });
  await expect(pending).rejects.toThrow("BLK-PATCH-001");
  expect(controller.getSnapshot().project.manifest.displayName).toBe(
    "并发编辑",
  );
  expect(
    controller.getSnapshot().project.workspaces["research-agent"].blocks
      .blocks[0].fields!.ROLE,
  ).not.toBe("候选角色");
});

it("previews without mutation, applies all operations in one undo and rejects stale patches", async () => {
  const p = createStarter(),
    controller = new ProjectController(p);
  const before = await projectDigest(p);
  const patch = await makePatch(p, [
    {
      op: "block.add",
      moduleId: "research-agent",
      blockId: "new-retriever",
      payload: {
        type: "core.knowledge.retrieve",
        id: "new-retriever",
        fields: { RESOURCE: "product-handbook" },
        x: 400,
        y: 100,
      },
    },
  ]);
  const preview = await previewPatch(p, patch);
  expect(await projectDigest(p)).toBe(before);
  expect(preview.next.workspaces["research-agent"].blocks.blocks).toHaveLength(
    2,
  );
  await applyPatch(controller, patch, []);
  expect(controller.getSnapshot().canUndo).toBe(true);
  await expect(applyPatch(controller, patch, [])).rejects.toThrow(
    "BLK-PATCH-001",
  );
  controller.undo();
  expect(await projectDigest(controller.getSnapshot().project)).toBe(before);
});
it("keeps the whole project unchanged on a later invalid operation and rechecks independent permissions", async () => {
  const p = createStarter(),
    controller = new ProjectController(p);
  const patch = await makePatch(p, [
    {
      op: "block.update",
      moduleId: "research-agent",
      blockId: "research-root",
      payload: { fields: { ROLE: "新的角色" } },
    },
  ]);
  const before = JSON.stringify(controller.getSnapshot().project);
  patch.operations.push({
    op: "block.remove",
    moduleId: "missing",
    blockId: "missing",
  });
  await expect(applyPatch(controller, patch, [])).rejects.toThrow();
  expect(JSON.stringify(controller.getSnapshot().project)).toBe(before);
  const q = createStarter();
  q.resources["product-handbook"].capabilityRequirements = ["private.read"];
  q.workspaces[
    "citation-service"
  ].blocks.blocks[0].inputs!.BODY.block!.disabled = true;
  const changed = await makePatch(q, [
    {
      op: "block.add",
      moduleId: "research-agent",
      blockId: "extra-query",
      payload: {
        type: "core.knowledge.retrieve",
        id: "extra-query",
        fields: { RESOURCE: "product-handbook" },
      },
    },
  ]);
  expect(changed.permissionDelta).toContain("private.read");
  const c = new ProjectController(q);
  await expect(applyPatch(c, changed, [])).rejects.toThrow("BLK-PATCH-003");
  const forged = structuredClone(changed);
  forged.permissionDelta = [];
  await expect(
    applyPatch(c, forged, ["private.read", "knowledge.read"]),
  ).rejects.toThrow("BLK-PATCH-003");
  await applyPatch(c, changed, changed.permissionDelta);
  expect(c.getSnapshot().dirty).toBe(true);
});
