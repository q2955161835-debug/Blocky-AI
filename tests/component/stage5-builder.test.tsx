// @vitest-environment jsdom
import { act, renderHook, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectController } from "../../packages/project-model/src";
import { createStarter } from "../../packages/test-fixtures/src";
import { createBuilderSession } from "../../packages/builder-protocol/src";
import { useBuilder } from "../../apps/studio-desktop/src/composition/useBuilder";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
const native = vi.hoisted(() => vi.fn());
beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = { invoke: native };
});
afterEach(() => {
  cleanup();
  native.mockReset();
  delete (window as any).__TAURI_INTERNALS__;
});
function studio() {
  const controller = new ProjectController(createStarter());
  return {
    controller,
    snapshot: controller.getSnapshot(),
    session: { active: "research-agent" },
    selected: null,
    selectedRoots: [],
    resources: { map: new Map(), flush: async () => {} },
    setMessage: vi.fn(),
  } as unknown as Studio;
}
async function result(s: Studio, request: any) {
  const session = await createBuilderSession(
    s.controller.getSnapshot().project,
    request,
  );
  session.draft({ plan: ["调整角色"], acceptanceCriteria: ["编译通过"] });
  await session.patch({
    operations: [
      {
        op: "block.update",
        moduleId: "research-agent",
        blockId: "research-root",
        payload: { fields: { ROLE: "植物课堂" } },
      },
    ],
  });
  await session.verify();
  return { ...session.result(), modelApiCalled: false, generations: [] };
}
it("keeps generated changes as a proposal and discards them when cancelled", async () => {
  const s = studio(),
    before = JSON.stringify(s.controller.getSnapshot().project);
  native.mockImplementation(async (name, args) =>
    name === "builder_run" ? result(s, args.start.request) : undefined,
  );
  const hook = renderHook(() => useBuilder(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    await hook.result.current.generate({
      intent: "build",
      prompt: "植物课堂",
      createSurface: false,
      mode: "deterministic",
      resourceId: "",
    });
  });
  expect(hook.result.current.result?.patch).toBeDefined();
  expect(JSON.stringify(s.controller.getSnapshot().project)).toBe(before);
  act(() => hook.result.current.clear());
  expect(hook.result.current.result).toBeUndefined();
});
it("rejects a candidate arriving after the project changed", async () => {
  const s = studio();
  let release: () => void = () => {};
  let ready: () => void = () => {};
  const candidateReady = new Promise<void>((resolve) => (ready = resolve));
  native.mockImplementation(async (name, args) => {
    if (name !== "builder_run") return;
    const candidate = await result(s, args.start.request);
    const held = new Promise<void>((r) => (release = r));
    ready();
    await held;
    return candidate;
  });
  const hook = renderHook(() => useBuilder(s));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let pending: Promise<void>;
  await act(async () => {
    pending = hook.result.current.generate({
      intent: "build",
      prompt: "植物课堂",
      createSurface: false,
      mode: "deterministic",
      resourceId: "",
    });
    await candidateReady;
  });
  s.controller.edit((p) => {
    p.manifest.displayName = "new edit";
  });
  await act(async () => {
    release();
    await pending!;
  });
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.error).toContain("BLK-PATCH-001");
});
