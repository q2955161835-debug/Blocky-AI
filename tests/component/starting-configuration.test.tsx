// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../apps/studio-desktop/node_modules/@tauri-apps/api/core.js";
import { createStartingBlueprint } from "../../packages/block-catalog/src/starting-blueprints";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { StartingConfiguration } from "../../apps/studio-desktop/src/app/StartingConfiguration";

const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../apps/studio-desktop/node_modules/@tauri-apps/api/core.js", () => ({
  invoke: io.invoke,
  isTauri: () => true,
}));

let workspaceStatus: Record<string, unknown>;
const initialChange = {
  changeId: "change-1",
  path: "src/report.md",
  before: "old report",
  after: "new report",
  beforeDigest: "a".repeat(64),
  afterDigest: "b".repeat(64),
};

function studioFor(id: string): Studio {
  const project = createStartingBlueprint(id, `${id}-config-test`);
  return {
    snapshot: { project, revision: 0 },
    resources: { map: new Map(), registry: { revision: 0 } },
  } as unknown as Studio;
}

beforeEach(() => {
  workspaceStatus = {
    available: false,
    workspaceId: null,
    displayName: null,
    changes: [],
  };
  io.invoke.mockImplementation(async (command: string) => {
    if (command === "workspace_status") return workspaceStatus as never;
    if (command === "coding_workspace_pick") {
      workspaceStatus = {
        available: true,
        workspaceId: "workspace-test",
        displayName: "合成仓库",
        changes: [initialChange],
      };
      return workspaceStatus as never;
    }
    if (command === "knowledge_sources")
      return { generation: 0, sources: [] } as never;
    if (command === "knowledge_load_index")
      return { generation: 0, revision: 0, value: null } as never;
    throw Error(`Unexpected Host command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("points a knowledge starter to add-and-sync and model configuration", async () => {
  const execute = vi.fn();
  const project = studioFor("knowledge-assistant");
  render(<StartingConfiguration studio={project} execute={execute} />);

  await screen.findByText("添加资料来源，然后同步资料。");
  fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
  fireEvent.click(screen.getByRole("button", { name: "添加并同步资料" }));
  expect(execute).toHaveBeenNthCalledWith(1, "settings.resources");
  expect(execute).toHaveBeenNthCalledWith(2, "settings.resources");
  expect(io.invoke).toHaveBeenCalledWith("knowledge_sources", {
    projectId: "knowledge-assistant-config-test",
    collectionId: "assistant-knowledge",
  });
  expect(io.invoke).toHaveBeenCalledWith("knowledge_load_index", {
    projectId: "knowledge-assistant-config-test",
    collectionId: "assistant-knowledge",
  });
  expect(screen.queryByText(/运行失败/)).toBeNull();
});

it("selects and reports a real work directory for the work assistant", async () => {
  const project = studioFor("work-assistant");
  render(<StartingConfiguration studio={project} execute={vi.fn()} />);

  await screen.findByText("选择工作目录，文件工具将在该目录内执行。");
  fireEvent.click(screen.getByRole("button", { name: "选择工作目录" }));
  await screen.findByText("工作目录已选择：合成仓库 · 1 条变更记录");
  expect(io.invoke).toHaveBeenCalledWith("coding_workspace_pick", {
    projectId: "work-assistant-config-test",
  });
  expect(io.invoke).toHaveBeenCalledWith("workspace_status", {
    projectId: "work-assistant-config-test",
  });
  expect(screen.queryByText(/权限不足|项目权限/)).toBeNull();
});

it("does not report a workspace requirement for a Pi Agent without tools", async () => {
  const project = studioFor("pi-agent");
  render(<StartingConfiguration studio={project} execute={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole("button", { name: "配置模型" })).toBeTruthy());
  expect(screen.queryByText(/工作目录/)).toBeNull();
  expect(screen.queryByText(/纯聊天|运行失败/)).toBeNull();
  expect(io.invoke).not.toHaveBeenCalledWith(
    "coding_workspace_pick",
    expect.anything(),
  );
});

it("ignores a workspace status response after switching to a different project", async () => {
  let resolveWorkStatus!: (value: unknown) => void;
  io.invoke.mockImplementation(async (command: string, args?: { projectId?: string }) => {
    if (command === "workspace_status" && args?.projectId === "work-assistant-config-test")
      return new Promise((resolve) => {
        resolveWorkStatus = resolve;
      }) as never;
    if (command === "workspace_status")
      return {
        available: false,
        workspaceId: null,
        displayName: null,
        changes: [],
      } as never;
    if (command === "knowledge_sources") return { generation: 0, sources: [] } as never;
    if (command === "knowledge_load_index")
      return { generation: 0, revision: 0, value: null } as never;
    throw Error(`Unexpected Host command: ${command}`);
  });

  const execute = vi.fn();
  const { rerender } = render(
    <StartingConfiguration studio={studioFor("work-assistant")} execute={execute} />,
  );
  await waitFor(() => expect(resolveWorkStatus).toBeTypeOf("function"));

  rerender(<StartingConfiguration studio={studioFor("pi-agent")} execute={execute} />);
  await screen.findByRole("button", { name: "配置模型" });

  resolveWorkStatus({
    available: true,
    workspaceId: "old-workspace",
    displayName: "旧项目目录",
    changes: [],
  });

  await waitFor(() => expect(screen.queryByText(/旧项目目录/)).toBeNull());
  expect(screen.queryByText(/选择工作目录|已选择/)).toBeNull();
});

it("shows a validated workspace diff, undoes it through Host, and refreshes its receipt", async () => {
  const undoneChange = {
    changeId: "change-undo-1",
    revertsChangeId: initialChange.changeId,
    path: initialChange.path,
    before: initialChange.after,
    after: initialChange.before,
    beforeDigest: initialChange.afterDigest,
    afterDigest: initialChange.beforeDigest,
  };
  workspaceStatus = {
    available: true,
    workspaceId: "workspace-test",
    displayName: "合成仓库",
    changes: [initialChange],
  };
  io.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "workspace_status") return workspaceStatus as never;
    if (command === "coding_undo") {
      expect(args).toEqual({
        workspaceId: "workspace-test",
        changeId: initialChange.changeId,
      });
      workspaceStatus = { ...workspaceStatus, changes: [undoneChange] };
      return undoneChange as never;
    }
    if (command === "knowledge_sources") return { generation: 0, sources: [] } as never;
    if (command === "knowledge_load_index")
      return { generation: 0, revision: 0, value: null } as never;
    throw Error(`Unexpected Host command: ${command}`);
  });

  render(<StartingConfiguration studio={studioFor("work-assistant")} execute={vi.fn()} />);
  await screen.findByText("工作目录已选择：合成仓库 · 1 条变更记录");
  expect(screen.getByText(initialChange.path)).toBeTruthy();
  fireEvent.click(screen.getByText("查看差异"));
  expect(screen.getByText("old report")).toBeTruthy();
  expect(screen.getByText("new report")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: `撤回 ${initialChange.path}` }));
  await screen.findByText("已撤回");
  expect(screen.queryByRole("button", { name: `撤回 ${initialChange.path}` })).toBeNull();
  expect(
    io.invoke.mock.calls.filter(([command]) => command === "workspace_status").length,
  ).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("old report")).toBeTruthy();
  expect(screen.getByText("new report")).toBeTruthy();
});

it("refreshes workspace receipts when a runtime result completes", async () => {
  workspaceStatus = {
    available: true,
    workspaceId: "workspace-test",
    displayName: "合成仓库",
    changes: [],
  };
  io.invoke.mockImplementation(async (command: string) => {
    if (command === "workspace_status") return workspaceStatus as never;
    if (command === "knowledge_sources") return { generation: 0, sources: [] } as never;
    if (command === "knowledge_load_index")
      return { generation: 0, revision: 0, value: null } as never;
    throw Error(`Unexpected Host command: ${command}`);
  });
  const execute = vi.fn();
  const initial = studioFor("work-assistant");
  const { rerender } = render(
    <StartingConfiguration studio={initial} execute={execute} />,
  );
  await screen.findByText("工作目录已选择：合成仓库 · 0 条变更记录");

  workspaceStatus = { ...workspaceStatus, changes: [initialChange] };
  rerender(
    <StartingConfiguration
      studio={{
        ...initial,
        result: { events: [] } as unknown as Studio["result"],
      }}
      execute={execute}
    />,
  );

  expect(await screen.findByText(initialChange.path)).toBeTruthy();
});
