import { expect, it } from "vitest";
import { createStarter } from "../../packages/test-fixtures/src";
import { configureBlock } from "../../packages/project-model/src";
import { makePatch, previewPatch } from "../../packages/builder-protocol/src";
import { validatePatch } from "../../tools/blocky-cli/src/native-store";
import { walkBlocks } from "../../packages/block-catalog/src";

it("Host accepts the same minimal missing-resource repair as the shared domain", async () => {
  const project = createStarter();
  const moduleId = "citation-service";
  const block = [
    ...walkBlocks(project.workspaces[moduleId].blocks.blocks),
  ].find((b) => b.type === "core.knowledge.retrieve")!;
  configureBlock(project, moduleId, block.id, "RESOURCE", "missing-resource");
  const original = structuredClone(project);
  const patch = await makePatch(project, [
    {
      op: "block.update",
      moduleId,
      blockId: block.id,
      payload: { fields: { RESOURCE: "product-handbook" } },
    },
  ]);
  const review = await previewPatch(project, patch);
  expect(review.diagnostics).toEqual([]);
  await expect(
    validatePatch(project, patch, patch.permissionDelta),
  ).resolves.toEqual(review.next);
  expect(project).toEqual(original);
});

it("repairs a missing model reference with the same strict post-repair checks", async () => {
  const project = createStarter();
  configureBlock(
    project,
    "research-agent",
    "compose-answer",
    "RESOURCE",
    "missing-model",
  );
  const patch = await makePatch(project, [
    {
      op: "block.update",
      moduleId: "research-agent",
      blockId: "compose-answer",
      payload: { fields: { RESOURCE: "local-composer" } },
    },
  ]);
  const review = await previewPatch(project, patch);
  await expect(
    validatePatch(project, patch, patch.permissionDelta),
  ).resolves.toEqual(review.next);
});

it("does not credit capabilities from an unresolved reference or permit an invalid repaired project", async () => {
  const project = createStarter();
  project.resources["product-handbook"].capabilityRequirements = [
    "fixture.private.read",
  ];
  configureBlock(
    project,
    "citation-service",
    "lookup-documents",
    "RESOURCE",
    "missing-resource",
  );
  const patch = await makePatch(project, [
    {
      op: "block.update",
      moduleId: "citation-service",
      blockId: "lookup-documents",
      payload: { fields: { RESOURCE: "product-handbook" } },
    },
  ]);
  expect(patch.permissionDelta).toContain("fixture.private.read");
  await expect(validatePatch(project, patch, [])).rejects.toMatchObject({
    code: "BLK-PATCH-003",
  });
  await expect(
    validatePatch(project, { ...patch, permissionDelta: [] }, []),
  ).rejects.toMatchObject({ code: "BLK-PATCH-003" });
  const invalid = structuredClone(patch);
  invalid.operations = [
    {
      op: "block.update",
      moduleId: "citation-service",
      blockId: "lookup-documents",
      payload: { fields: { RESOURCE: "still-missing" } },
    },
  ];
  await expect(
    validatePatch(project, invalid, patch.permissionDelta),
  ).rejects.toMatchObject({ code: "BLK-PATCH-002" });
});
