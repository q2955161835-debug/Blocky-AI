// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import type { SourceRef } from "../../packages/language-schema/src/index";
import type { RuntimeEvent } from "../../packages/observability/src/index";
import { createModule } from "../../packages/project-model/src/index";
import { App } from "../../apps/studio-desktop/src/app/App";
const observed = vi.hoisted(() => ({ studio: undefined as Studio | undefined, context: vi.fn() }));
vi.mock("../../packages/ui-editor/src/index.ts", () => ({ Canvas: () => null }));
vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: vi.fn(async () => ({
    project: (await import("../../packages/test-fixtures/src")).createStarter(), handle: "test-existing",
  })), saveProject: vi.fn(),
  readPreferences: () => ({ reduceMotion: false, view: "professional", minimizeToTray: true }),
  writePreferences: vi.fn(),
}));
vi.mock("../../apps/studio-desktop/src/app/RunPanel", async () => {
  const { TracePanel } = await import("../../apps/studio-desktop/src/app/TracePanel");
  return { RunPanel: ({ studio, onTraceContext }: {
    studio: Studio; onTraceContext: (x: number, y: number, source: SourceRef) => void;
  }) => {
    observed.studio = studio;
    const event: RuntimeEvent = {
      eventVersion: "blocky.event/v1alpha1", projectId: studio.snapshot.project.manifest.projectId,
      runId: "context-run", sequence: 1, timestamp: "2026-09-27T00:00:00.000Z",
      type: "run.started", data: {}, redaction: { applied: false, categories: [] },
    };
    return <TracePanel studio={{ ...studio, events: [event, {
      ...event, sequence: 2, type: "block.started", moduleId: "research-agent", blockId: "research-root",
    }] }} onContext={(x, y, source) => {
      observed.context(source);
      onTraceContext(x, y, source);
    }} />;
  } };
});
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); observed.studio = undefined; });
async function openStudio() {
  render(<App />);
  await waitFor(() => expect((screen.getByRole("button", { name: "＋ 新建项目" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "打开本机项目" }));
  await waitFor(() => expect(observed.studio?.canRun).toBe(true));
}
it("disables breakpoint on a project event instead of reusing the selected canvas block", async () => {
  await openStudio();
  act(() => observed.studio!.setSelected("research-root"));
  fireEvent.contextMenu(screen.getByRole("button", { name: /#1 run.started/ }));
  const dialog = screen.getByRole("dialog", { name: "上下文菜单" });
  expect((within(dialog).getByRole("button", { name: /切换断点/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(observed.studio!.breakpoints).toEqual([]);
});
it("keeps the trace source for breakpoint commands after canvas selection is cleared", async () => {
  await openStudio();
  act(() => observed.studio!.controller.edit((project) => createModule(project, "other-canvas", "另一画布")));
  fireEvent.contextMenu(screen.getByRole("button", { name: /#2 block.started/ }));
  expect(observed.context).toHaveBeenLastCalledWith({
    projectId: observed.studio!.snapshot.project.manifest.projectId,
    moduleId: "research-agent", blockId: "research-root",
  });
  act(() => {
    observed.studio!.setSelected(null);
    observed.studio!.setSession((session) => ({ ...session, active: "other-canvas" }));
  });
  const button = within(screen.getByRole("dialog", { name: "上下文菜单" }))
    .getByRole("button", { name: /切换断点/ }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(observed.studio!.breakpoints).toEqual([{ moduleId: "research-agent", blockId: "research-root" }]);
});
