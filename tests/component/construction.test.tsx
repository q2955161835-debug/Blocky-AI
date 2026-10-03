// @vitest-environment jsdom
import { createStarter } from "../../packages/test-fixtures/src";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { useConstruction } from "../../apps/studio-desktop/src/composition/useConstruction";
import { ConstructionDialog } from "../../apps/studio-desktop/src/app/ConstructionDialog";
import { captureBlueprint, instantiateBlueprint, defaultBindings } from "../../packages/block-catalog/src";
import { projectDigest } from "../../packages/project-model/src";
vi.mock("../../apps/studio-desktop/src/composition/knowledge", async () => {
  const fixture = await (
    await import("../helpers/conversion")
  ).conversionFixture();
  return { knowledgeNative: fixture.call };
});
vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: vi.fn(),
  saveProject: vi.fn(),
  readPreferences: () => ({
    reduceMotion: false,
    view: "professional",
    minimizeToTray: true,
  }),
  writePreferences: vi.fn(),
  validatePatch: async (project: any, patch: unknown) =>
    (
      await (
        await import("../../packages/builder-protocol/src")
      ).previewPatch(project, patch)
    ).next,
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
// jsdom has no modal top layer; this shim only exposes dialog content for component assertions.
// Focus trapping and native modal behavior remain ordinary-package/F acceptance items.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
function useEditor() {
  const studio = useStudio(createStarter());
  return { studio, construction: useConstruction(studio) };
}
it("previews a personal blueprint restore without losing user edits before acceptance", async () => {
  const project = createStarter();
  const blueprint = await captureBlueprint(project, "research-agent", ["research-root"], "个人问答");
  project.workspaces["research-agent"].blocks.blocks = [];
  project.workspaces["research-agent"].blocks.blocks = await instantiateBlueprint(
    blueprint, project, "research-agent", defaultBindings(blueprint), { x: 0, y: 0 }, id => id,
  );
  localStorage.setItem("blocky.blueprints.v1", JSON.stringify([blueprint]));
  const hook = renderHook(useEditor);
  act(() => hook.result.current.studio.controller.replace(project));
  await waitFor(() => expect(hook.result.current.construction.blueprints).toHaveLength(1));
  await waitFor(() => expect(hook.result.current.studio.compiling).toBe(false));
  act(() => {
    hook.result.current.studio.setSelectedRoots(["research-root"]);
    hook.result.current.studio.updateField(
      "research-root",
      "ROLE",
      "我的工时助手",
    );
  });
  const before = await projectDigest(
    hook.result.current.studio.snapshot.project,
  );
  act(() =>
    expect(
      hook.result.current.construction.blueprintUpdate.prepare("restore"),
    ).toBe(true),
  );
  await act(() => hook.result.current.construction.blueprintUpdate.preview());
  expect(hook.result.current.construction.review).toBeDefined();
  expect(await projectDigest(hook.result.current.studio.snapshot.project)).toBe(
    before,
  );
  act(() => hook.result.current.construction.reject());
  expect(await projectDigest(hook.result.current.studio.snapshot.project)).toBe(
    before,
  );
  await act(() => hook.result.current.construction.blueprintUpdate.preview());
  await act(() => hook.result.current.construction.accept([]));
  expect(
    hook.result.current.studio.snapshot.project.workspaces["research-agent"]
      .blocks.blocks[0].fields!.ROLE,
  ).not.toBe("我的工时助手");
  act(() => hook.result.current.studio.controller.undo());
  expect(await projectDigest(hook.result.current.studio.snapshot.project)).toBe(
    before,
  );
});
it("keeps an unreadable personal library intact when saving a captured blueprint", async () => {
  localStorage.setItem("blocky.blueprints.v1", "broken library");
  const hook = renderHook(useEditor);
  await waitFor(() =>
    expect(hook.result.current.studio.message).toContain("本机蓝图库无法读取"),
  );
  act(() => hook.result.current.studio.setSelectedRoots(["research-root"]));
  await act(() => hook.result.current.construction.capture());
  await act(() => hook.result.current.construction.save());
  expect(localStorage.getItem("blocky.blueprints.v1")).toBe("broken library");
});
it("saves a real personal blueprint, previews editable blocks, rejects without changes and undoes acceptance", async () => {
  const hook = renderHook(useEditor);
  await waitFor(() => expect(hook.result.current.studio.compiling).toBe(false));
  const before = await projectDigest(
    hook.result.current.studio.snapshot.project,
  );
  act(() => hook.result.current.studio.setSelectedRoots(["research-root"]));
  await act(() => hook.result.current.construction.capture());
  act(() => hook.result.current.construction.setName("课堂问答"));
  await act(() => hook.result.current.construction.save());
  expect(
    JSON.parse(localStorage.getItem("blocky.blueprints.v1")!)[0].displayName,
  ).toBe("课堂问答");
  act(() =>
    hook.result.current.construction.prepareInsert(
      hook.result.current.construction.blueprints[0],
    ),
  );
  await act(() => hook.result.current.construction.previewInsert());
  const view = render(
    <ConstructionDialog
      studio={hook.result.current.studio}
      construction={hook.result.current.construction}
      kind="patch-review"
      close={() => undefined}
      showReview={() => undefined}
    />,
  );
  expect(screen.getByLabelText("幽灵积木预览").textContent).toContain("智能体");
  fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
  expect(await projectDigest(hook.result.current.studio.snapshot.project)).toBe(
    before,
  );
  expect(hook.result.current.construction.review).toBeUndefined();
  view.unmount();
  await act(() => hook.result.current.construction.previewInsert());
  await act(() => hook.result.current.construction.accept([]));
  expect(
    hook.result.current.studio.snapshot.project.workspaces["research-agent"]
      .blocks.blocks,
  ).toHaveLength(2);
  act(() => hook.result.current.studio.controller.undo());
  expect(await projectDigest(hook.result.current.studio.snapshot.project)).toBe(
    before,
  );
});
it("refuses a stale conversion preview and preserves edits made after review", async () => {
  const hook = renderHook(useEditor);
  await waitFor(() => expect(hook.result.current.studio.compiling).toBe(false));
  await act(() => hook.result.current.construction.conversion.scan());
  await act(() =>
    hook.result.current.construction.conversion.candidate({
      file: "math.ts",
      symbol: "flow",
      lineStart: 2,
    }),
  );
  expect(hook.result.current.construction.candidate?.source.license).toBe(
    "MIT",
  );
  act(() =>
    hook.result.current.studio.controller.edit((p) => {
      p.manifest.displayName = "审阅后修改";
    }),
  );
  const current = await projectDigest(
    hook.result.current.studio.snapshot.project,
  );
  await act(() => hook.result.current.construction.accept([]));
  expect(await projectDigest(hook.result.current.studio.snapshot.project)).toBe(
    current,
  );
  expect(hook.result.current.studio.message).toContain("项目已改变");
});
