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
import { RunPanel } from "../fixtures/ChatPanelHarness";
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
it("formats the Blocky Agent answer without interpreting the submitted input", async () => {
  const hook = renderHook(() => useStudio(createStarter()));
  await waitFor(() => expect(hook.result.current.canRun).toBe(true));
  await act(() => hook.result.current.run());
  const result = hook.result.current.result!;
  render(<RunPanel studio={{ ...hook.result.current,
    runInput: "## **用户原文**",
    result: { ...result, answer: "## Agent 结果\n\n- **已完成**：`compile`\n\n| 项目 | 状态 |\n| --- | --- |\n| 画布 | 正常 |", citations: [] },
  }} execute={() => {}} />);
  expect(screen.getByRole("heading", { name: "Agent 结果", level: 2 })).toBeTruthy();
  expect(screen.getByText("已完成").tagName).toBe("STRONG");
  expect(screen.getByRole("cell", { name: "正常" })).toBeTruthy();
  expect(screen.getByText("## **用户原文**")).toBeTruthy();
});
it("binds the displayed input to common run entry, including external requests and debug runs", async () => {
  const hook = renderHook(() => useStudio(createStarter()));
  await waitFor(() => expect(hook.result.current.canRun).toBe(true));
  const panel = render(
    <RunPanel studio={hook.result.current} execute={() => {}} />,
  );
  act(() => hook.result.current.setQuestion("第一次聊天 中文😀"));
  await act(() => hook.result.current.run());
  panel.rerender(<RunPanel studio={hook.result.current} execute={() => {}} />);
  expect(screen.getByLabelText("Blocky Agent 聊天记录").textContent).toContain(
    "第一次聊天 中文😀",
  );
  act(() => hook.result.current.setQuestion("第二次顶部运行 🚀"));
  await act(() => hook.result.current.run(undefined, {}));
  panel.rerender(<RunPanel studio={hook.result.current} execute={() => {}} />);
  const thread = screen.getByLabelText("Blocky Agent 聊天记录");
  expect(thread.textContent).toContain("第二次顶部运行 🚀");
  expect(thread.textContent).toContain("第一次聊天 中文😀");
  const entry = hook.result.current.compiled!.interaction.entries[0];
  await act(() =>
    hook.result.current.run({
      question: "界面桥接输入",
      moduleId: entry.moduleId,
      interactionId: entry.interactionId,
      signal: new AbortController().signal,
    }),
  );
  act(() => hook.result.current.setQuestion("尚未提交的草稿"));
  panel.rerender(<RunPanel studio={hook.result.current} execute={() => {}} />);
  expect(thread.textContent).toContain("界面桥接输入");
  expect(thread.textContent).not.toContain("尚未提交的草稿");
  expect(screen.getByText(/运行轨迹 ·/).closest("details")?.open).toBe(true);
  expect(
    document.querySelectorAll(".trace-events [data-block-type]").length,
  ).toBeGreaterThan(0);
  await act(() => hook.result.current.fresh());
  panel.rerender(<RunPanel studio={hook.result.current} execute={() => {}} />);
  expect(screen.getByLabelText("Blocky Agent 聊天记录").textContent).not.toContain("界面桥接输入");
});
it("sends runtime input once on Enter, preserving composition and multiline editing", async () => {
  const hook = renderHook(() => useStudio(createStarter()));
  await waitFor(() => expect(hook.result.current.canRun).toBe(true));
  act(() => hook.result.current.setQuestion("测试问题"));
  const run = vi.fn(async () => undefined);
  render(
    <RunPanel studio={{ ...hook.result.current, run }} execute={() => {}} />,
  );
  const input = screen.getByLabelText("向 Agent 提问");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(run).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(run).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "刷新任务" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 设置" }));
  expect(screen.getByRole("button", { name: "刷新任务" })).toBeTruthy();
});
it("selects the second module even when its entry block ID is unchanged", async () => {
  const project = createStarter();
  project.manifest.modules.push({
    ...project.manifest.modules[0],
    moduleId: "teacher-agent",
    workspaceRef: "modules/teacher-agent/workspace.json",
  });
  project.workspaces["teacher-agent"] = structuredClone(
    project.workspaces["research-agent"],
  );
  const hook = renderHook(() => useStudio(createStarter()));
  act(() => hook.result.current.controller.replace(project));
  await waitFor(() =>
    expect(hook.result.current.compiled?.interaction.entries).toHaveLength(2),
  );
  render(<RunPanel studio={hook.result.current} execute={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 设置" }));
  fireEvent.change(screen.getByLabelText("运行入口"), {
    target: { value: JSON.stringify(["teacher-agent", "on-question"]) },
  });
  await act(() => hook.result.current.run());
  expect(hook.result.current.result?.status).toBe("completed");
  expect(
    hook.result.current.events.some(
      (e) => e.moduleId === "teacher-agent" && e.blockId === "research-root",
    ),
  ).toBe(true);
  expect(
    hook.result.current.events.some((e) => e.moduleId === "research-agent"),
  ).toBe(false);
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
  const hook = renderHook(() => useStudio(createStarter()));
  act(() => hook.result.current.controller.replace(project));
  await waitFor(() =>
    expect(hook.result.current.compiled?.interaction.entries).toHaveLength(2),
  );
  render(<RunPanel studio={hook.result.current} execute={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 设置" }));
  fireEvent.change(screen.getByLabelText("运行入口"), {
    target: { value: JSON.stringify(["research-agent", "on-question-second"]) },
  });
  act(() => hook.result.current.setQuestion("为什么树叶在秋天会变黄？"));
  await act(() => hook.result.current.run());
  expect(hook.result.current.result?.answer).toContain("学习要点");
  const started = hook.result.current.events.filter(
    (e) => e.type === "block.started",
  );
  expect(started.some((e) => e.blockId === "research-root-second")).toBe(true);
  expect(started.some((e) => e.blockId === "research-root")).toBe(false);
});
