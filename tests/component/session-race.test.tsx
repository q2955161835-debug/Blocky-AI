// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createStarter } from "../../packages/test-fixtures/src";

const io = vi.hoisted(() => {
  let resolve!: (value: unknown) => void;
  return {
    pending: new Promise<unknown>((r) => {
      resolve = r;
    }),
    resolve,
  };
});
vi.mock("../../apps/studio-desktop/src/composition/userState", () => ({
  readUserState: vi.fn(() => io.pending),
  writeUserState: vi.fn(async () => {}),
}));
import { useSession } from "../../apps/studio-desktop/src/composition/useSession";

it("keeps an explicit layout reset when the old session read resolves later", async () => {
  const project = createStarter();
  project.manifest.projectId = "reset-race-project";
  const hook = renderHook(() => useSession(project, () => {}));
  await waitFor(() => expect(hook.result.current.session.height).toBe(210));
  act(() => hook.result.current.reset());
  await act(async () => {
    io.resolve({
      schemaVersion: "blocky.workspace-session/v1alpha1",
      projectId: "reset-race-project",
      openTabs: [],
      bottomPanel: { visible: true, activeView: "problems", heightPx: 401 },
    });
    await Promise.resolve();
  });
  expect(hook.result.current.session.height).toBe(210);
});
