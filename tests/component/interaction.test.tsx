// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStarter } from "../../packages/test-fixtures/src";
import type { WorkspaceBlock } from "../../packages/language-schema/src";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { RunPanel } from "../../apps/studio-desktop/src/app/RunPanel";
vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: vi.fn(),
  saveProject: vi.fn(),
  readPreferences: () => ({
    reduceMotion: false,
    view: "professional",
    minimizeToTray: true,
  }),
  writePreferences: vi.fn(),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("runs the selected InteractionManifest entry instead of always executing the first agent", async () => {
  const project = createStarter();
  const second = structuredClone(
    project.workspaces["research-agent"].blocks.blocks[0],
  );
  function rekey(b: WorkspaceBlock) {
    b.id += "-second";
    for (const v of Object.values(b.inputs ?? {})) {
      if (v.block) rekey(v.block);
      if (v.shadow) rekey(v.shadow);
    }
    if (b.next) rekey(b.next.block);
  }
  rekey(second);
  second.fields!.ROLE = "科学教师";
  second.inputs!.BODY.block!.fields!.NAME = "教师入口";
  project.workspaces["research-agent"].blocks.blocks.push(second);
  const hook = renderHook(() => useStudio());
  act(() => hook.result.current.controller.replace(project));
  await waitFor(() =>
    expect(hook.result.current.compiled?.interaction.entries).toHaveLength(2),
  );
  render(<RunPanel studio={hook.result.current} />);
  fireEvent.change(screen.getByLabelText("运行入口"), {
    target: { value: "on-question-second" },
  });
  await act(() => hook.result.current.run());
  expect(hook.result.current.result?.answer).toContain("学习要点");
  const started = hook.result.current.events.filter(
    (e) => e.type === "block.started",
  );
  expect(started.some((e) => e.blockId === "research-root-second")).toBe(true);
  expect(started.some((e) => e.blockId === "research-root")).toBe(false);
});
