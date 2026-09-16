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
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";
import { Inspector } from "../../apps/studio-desktop/src/app/Inspector";
import { BottomPanel } from "../../apps/studio-desktop/src/app/BottomPanel";
import { createStarter } from "../../packages/test-fixtures/src";
it("revalidates session targets when reopening the same project ID", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  act(() =>
    hook.result.current.setSession((s) => ({
      ...s,
      tabs: ["citation-service"],
      active: "citation-service",
    })),
  );
  const p = createStarter();
  p.manifest.modules = p.manifest.modules.slice(0, 1);
  delete p.workspaces["citation-service"];
  io.open.mockResolvedValue({ project: p, handle: "same" });
  await act(() => hook.result.current.open());
  expect(hook.result.current.session.tabs).toEqual(["research-agent"]);
  expect(
    hook.result.current.session.diagnostics.some(
      (d) => d.code === "BLK-SESSION-002",
    ),
  ).toBe(true);
});
const io = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../apps/studio-desktop/src/composition/host", () => ({
  openProject: io.open,
  saveProject: io.save,
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
  vi.clearAllMocks();
});
it("editing the inspector changes the real project and undo restores it", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  act(() => hook.result.current.setSelected("research-root"));
  const view = render(<Inspector studio={hook.result.current} />);
  fireEvent.change(screen.getByLabelText("角色与指令"), {
    target: { value: "自然科学教师" },
  });
  expect(hook.result.current.snapshot.dirty).toBe(true);
  expect(
    hook.result.current.snapshot.project.workspaces["research-agent"].blocks
      .blocks[0].fields?.ROLE,
  ).toBe("自然科学教师");
  act(() => hook.result.current.controller.undo());
  view.rerender(<Inspector studio={hook.result.current} />);
  expect(
    (screen.getByLabelText("角色与指令") as HTMLTextAreaElement).value,
  ).not.toBe("自然科学教师");
});
it("navigation reopens a closed tab and the problem panel uses compiler diagnostics", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  act(() => {
    hook.result.current.setSession((s) => ({ ...s, tabs: ["research-agent"] }));
    hook.result.current.navigate({
      projectId: hook.result.current.snapshot.project.manifest.projectId,
      moduleId: "citation-service",
      blockId: "lookup-entry",
    });
  });
  expect(hook.result.current.session.tabs).toContain("citation-service");
  expect(hook.result.current.session.active).toBe("citation-service");
  act(() => hook.result.current.back());
  expect(hook.result.current.session.active).toBe("research-agent");
  act(() =>
    hook.result.current.controller.edit((p) => {
      p.manifest.modules[1].exports = [];
    }),
  );
  await waitFor(() =>
    expect(
      hook.result.current.compiled?.diagnostics.some(
        (d) => d.code === "BLK-LINK-002",
      ),
    ).toBe(true),
  );
  render(<BottomPanel studio={hook.result.current} />);
  expect(screen.getByText("BLK-LINK-002")).toBeTruthy();
});
it("save completion cannot mark later edits as saved and cancelled open preserves the project", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  let resolve!: (value: { handle: string; displayName: string }) => void;
  io.save.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  let pending: Promise<void>;
  act(() => {
    pending = hook.result.current.save();
  });
  act(() =>
    hook.result.current.controller.edit((p) => {
      p.manifest.displayName = "保存期间的新修改";
    }),
  );
  await act(async () => {
    resolve({ handle: "opaque", displayName: "sample.blocky" });
    await pending;
  });
  expect(hook.result.current.snapshot.dirty).toBe(true);
  io.open.mockResolvedValue(null);
  const before = hook.result.current.snapshot.project;
  let opening!: Promise<void>;
  act(() => {
    opening = hook.result.current.open();
  });
  expect(hook.result.current.confirmation).not.toBeNull();
  await act(async () => {
    hook.result.current.answerConfirmation(true);
    await opening;
  });
  expect(hook.result.current.snapshot.project).toBe(before);
});
it("cancelling unsaved changes keeps the project and never opens a native dialog", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  act(() =>
    hook.result.current.controller.edit((p) => {
      p.manifest.displayName = "未保存的内容";
    }),
  );
  const before = hook.result.current.snapshot.project;
  let opening!: Promise<void>;
  act(() => {
    opening = hook.result.current.open();
  });
  expect(hook.result.current.confirmation).not.toBeNull();
  expect(io.open).not.toHaveBeenCalled();
  await act(async () => {
    hook.result.current.answerConfirmation(false);
    await opening;
  });
  expect(hook.result.current.snapshot.project).toBe(before);
  expect(hook.result.current.snapshot.dirty).toBe(true);
  expect(hook.result.current.busy).toBe(false);
  expect(io.open).not.toHaveBeenCalled();
});
it("opening another project retains its own saved session without overwriting it first", async () => {
  const next = createStarter();
  next.manifest.projectId = "second-project";
  localStorage.setItem(
    "blocky.session.second-project",
    JSON.stringify({
      tabs: ["citation-service"],
      active: "citation-service",
      panel: false,
      view: "logs",
      height: 160,
    }),
  );
  io.open.mockResolvedValue({ project: next, handle: "second" });
  const hook = renderHook(() => useStudio());
  await waitFor(() => expect(hook.result.current.compiling).toBe(false));
  await act(() => hook.result.current.open());
  expect(hook.result.current.session.active).toBe("citation-service");
  expect(hook.result.current.session.panel).toBe(false);
  expect(
    JSON.parse(localStorage.getItem("blocky.session.second-project")!)
      .activeTabId,
  ).toBe("tab-citation-service");
});
