import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { ProjectController, projectDigest } from "../../project-model/src";
import { applyPatch, createBuilderSession, parseBuilderRequest } from "../src";

const request = (overrides = {}) => ({
  schemaVersion: "blocky.builder-request/v1",
  requestId: "request-1",
  projectId: "research-workbench",
  intent: "build",
  prompt: "改为解释植物生长的课堂助手",
  moduleId: "research-agent",
  selection: [],
  createSurface: false,
  ...overrides,
});
const plan = {
  plan: ["调整角色并保留资料引用流程"],
  acceptanceCriteria: ["编译无错误"],
};
const update = {
  op: "block.update",
  moduleId: "research-agent",
  blockId: "research-root",
  payload: { fields: { ROLE: "讲解植物生长" } },
};

it("stages a scoped plan and candidate without editing and applies through the existing transaction", async () => {
  const project = createStarter(),
    before = JSON.stringify(project);
  const session = await createBuilderSession(project, request());
  const inspected = session.inspect();
  expect(inspected.catalog.length).toBeGreaterThan(10);
  expect(JSON.stringify(inspected)).not.toContain("handbook-access");
  const spec = session.draft(plan);
  expect(spec.baseDigest).toBe(await projectDigest(project));
  const preview = await session.patch({ operations: [update] });
  expect((await session.verify()).passed).toBe(true);
  expect(session.result().patch).toEqual(preview.patch);
  expect(JSON.stringify(project)).toBe(before);
  const controller = new ProjectController(project);
  await applyPatch(controller, preview.patch, []);
  controller.undo();
  expect(await projectDigest(controller.getSnapshot().project)).toBe(
    spec.baseDigest,
  );
});

it("does not allow explanations to create patches and binds explanations to current selection", async () => {
  const session = await createBuilderSession(
    createStarter(),
    request({ intent: "explain", selection: ["compose-answer"] }),
  );
  expect(session.inspect().selection[0].id).toBe("compose-answer");
  session.draft({ ...plan, explanation: "所选模型积木整理答案。" });
  await expect(session.patch({ operations: [update] })).rejects.toThrow(
    "BLK-BUILDER-003",
  );
  expect(session.result().patch).toBeUndefined();
  expect(session.result().explanation).toContain("模型");
});

it("refuses missing targets, implicit surfaces, tool names, raw workspace fields and out-of-scope edits", async () => {
  expect(() => parseBuilderRequest(request({ shell: "whoami" }))).toThrow(
    "BLK-BUILDER-001",
  );
  await expect(
    createBuilderSession(createStarter(), request({ moduleId: "missing" })),
  ).rejects.toThrow("BLK-BUILDER-002");
  await expect(
    createBuilderSession(createStarter(), request({ selection: ["missing"] })),
  ).rejects.toThrow("BLK-BUILDER-002");
  const session = await createBuilderSession(createStarter(), request());
  session.draft(plan);
  await expect(
    session.patch({ operations: [update], workspace: {} }),
  ).rejects.toThrow("BLK-BUILDER-001");
  await expect(
    session.patch({
      operations: [{ ...update, moduleId: "citation-service" }],
    }),
  ).rejects.toThrow("BLK-BUILDER-003");
  await expect(session.call("shell", {})).rejects.toThrow("BLK-BUILDER-003");
  await expect(
    session.patch({ operations: [{ op: "app-surface.add" }] }),
  ).rejects.toThrow();
});

it("rejects repair outside selected diagnostics and does not hide unresolved errors", async () => {
  const project = createStarter();
  const session = await createBuilderSession(
    project,
    request({ intent: "repair", selection: ["compose-answer"] }),
  );
  session.draft(plan);
  await expect(session.patch({ operations: [update] })).rejects.toThrow(
    "BLK-BUILDER-003",
  );
});

it("requires inspect then draft before patch and invalidates candidate on cancellation", async () => {
  const session = await createBuilderSession(createStarter(), request());
  await expect(session.patch({ operations: [update] })).rejects.toThrow(
    "BLK-BUILDER-004",
  );
  session.draft(plan);
  await session.patch({ operations: [update] });
  session.cancel();
  expect(() => session.result()).toThrow("BLK-BUILDER-CANCELLED");
  await expect(session.verify()).rejects.toThrow("BLK-BUILDER-CANCELLED");
});

it("snapshots authorized input and prevents malformed or credential-bearing requests", async () => {
  expect(() => parseBuilderRequest(request({ prompt: "" }))).toThrow(
    "BLK-BUILDER-001",
  );
  expect(() =>
    parseBuilderRequest(request({ prompt: "x".repeat(16001) })),
  ).toThrow("BLK-BUILDER-001");
  expect(() =>
    parseBuilderRequest(request({ prompt: "api_key=fictional-canary" })),
  ).toThrow("BLK-BUILDER-001");
  const project = createStarter(),
    session = await createBuilderSession(project, request());
  project.manifest.displayName = "changed externally";
  expect(session.inspect().projectName).not.toBe("changed externally");
});
