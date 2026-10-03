// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { Welcome } from "../../apps/studio-desktop/src/app/Welcome";

vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: vi.fn(),
  saveProject: vi.fn(),
  readPreferences: () => ({ reduceMotion: false, view: "professional", minimizeToTray: true }),
  writePreferences: vi.fn(),
}));
afterEach(() => { cleanup(); localStorage.clear(); });

it("offers blank creation without retired starter cards or future templates", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  render(<Welcome studio={hook.result.current} />);
  expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual([
    "＋ 新建项目", "打开本机项目",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "＋ 新建项目" }));
  await waitFor(() => expect(hook.result.current.started).toBe(true));
  const project = hook.result.current.snapshot.project;
  expect(project.manifest.modules).toHaveLength(1);
  expect(Object.values(project.workspaces).flatMap(w => w.blocks.blocks)).toEqual([]);
  expect(project.resources).toEqual({});
  expect(project.manifest.resources).toEqual([]);
  expect(project.manifest.appSurfaces).toEqual([]);
  expect(hook.result.current.question).toBe("");
});

it("starts empty before opening and gives each new project its own identity", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  expect(Object.values(hook.result.current.snapshot.project.workspaces).flatMap(w => w.blocks.blocks)).toEqual([]);
  const initial = hook.result.current.snapshot.project.manifest.projectId;
  await act(() => hook.result.current.fresh());
  const first = hook.result.current.snapshot.project.manifest.projectId;
  await act(() => hook.result.current.fresh());
  expect(new Set([initial, first, hook.result.current.snapshot.project.manifest.projectId]).size).toBe(3);
});
