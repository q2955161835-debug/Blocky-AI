import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import {
  draftSurface,
  validateSurface,
  previewDocument,
  validateBridgeRequest,
  createBridge,
} from "../src";
import {
  restoreSession,
  serializeSession,
  ProjectController,
} from "../../project-model/src";
import { makePatch, applyPatch } from "../../builder-protocol/src";
import { encodeProject, decodeProject } from "../../project-format/src";
it("requires explicit intent, locks source files and exposes only the declared bridge", async () => {
  const project = createStarter();
  await expect(
    draftSurface(project, "research-agent", "agent-request"),
  ).rejects.toThrow("BLK-SURFACE-001");
  const draft = await draftSurface(
    project,
    "research-agent",
    "explicit-user-command",
  );
  expect(project.manifest.appSurfaces).toHaveLength(0);
  expect(validateSurface(project, draft).manifest.associatedModuleIds).toEqual([
    "research-agent",
  ]);
  const html = previewDocument(draft);
  expect(html).toContain("default-src 'none'");
  expect(html).not.toContain('src="page.js"');
  const changed = structuredClone(draft);
  changed.files[`${draft.manifest.sourceRootRef}/page.js`] =
    "fetch('https://example.com')";
  expect(() => validateSurface(project, changed)).toThrow("BLK-SURFACE-002");
  expect(() =>
    validateBridgeRequest({
      schemaVersion: "blocky.bridge-request/v1alpha1",
      requestId: "request-1",
      endpointId: "shell",
      question: "hi",
    }),
  ).toThrow("BLK-SURFACE-002");
});
it("keeps browser tabs out of project semantics and preserves raw source through save, close and undo", async () => {
  const original = createStarter(),
    draft = await draftSurface(
      original,
      "research-agent",
      "explicit-user-command",
    ),
    controller = new ProjectController(original);
  const patch = await makePatch(original, [
    { op: "app-surface.add", ...draft },
  ]);
  await expect(applyPatch(controller, patch, [])).rejects.toThrow(
    "BLK-PATCH-003",
  );
  await applyPatch(controller, patch, patch.permissionDelta);
  const project = controller.getSnapshot().project,
    decoded = decodeProject(encodeProject(project));
  expect(decoded).toEqual(project);
  const key = `surface:${draft.manifest.surfaceId}`,
    session = restoreSession(project, { tabs: [key], active: key });
  const saved = serializeSession(project, session);
  expect(saved.openTabs[0].kind).toBe("browser");
  expect(restoreSession(project, saved).active).toBe(key);
  expect(
    restoreSession(project, { ...session, tabs: [], active: "" }).tabs,
  ).toEqual([]);
  expect(project.manifest.appSurfaces).toHaveLength(1);
  controller.undo();
  expect(controller.getSnapshot().project).toEqual(original);
});
it("rejects undeclared bridge requests, prevents replay and aborts its own pending run on close", async () => {
  let called = 0,
    aborted = false;
  const replies: unknown[] = [];
  const bridge = createBridge(
    async (_, signal) => {
      called++;
      return new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve(undefined);
          },
          { once: true },
        ),
      );
    },
    (reply) => replies.push(reply),
  );
  const request = {
    schemaVersion: "blocky.bridge-request/v1alpha1",
    requestId: "request-1",
    endpointId: "ask",
    question: "树叶",
  };
  await bridge.receive({ ...request, endpointId: "shell" });
  expect(called).toBe(0);
  const pending = bridge.receive(request);
  await bridge.receive(request);
  expect(called).toBe(1);
  expect(replies).toHaveLength(1);
  bridge.close();
  await pending;
  expect(aborted).toBe(true);
  expect(replies).toHaveLength(1);
});
