// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { CodingAgent } from "../../apps/studio-desktop/src/composition/useCodingAgent";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { BuilderPanel } from "../../apps/studio-desktop/src/app/BuilderPanel";
import { useStudio } from "../../apps/studio-desktop/src/composition/useStudio";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function readyStudio() {
  const hook = renderHook(() => useStudio());
  await waitFor(() =>
    expect(
      hook.result.current.settings.ready && hook.result.current.resources.ready,
    ).toBe(true),
  );
  const s=hook.result.current;
  s.resources.map.set("test-model",{resourceId:"test-model",kind:"model",scope:"user",displayName:"测试模型",definition:{provider:"deepseek",protocol:"openai-chat",modelId:"test",capabilities:["text","tools"],implementationRef:"adapter://deepseek-v1"},secretBindings:[{fieldId:"apiKey",secretRef:"synthetic-ref"}]} as any);
  s.settings.layers.app={schemaVersion:"blocky.settings/v1",scope:"app",values:{"models.defaultResourceId":"test-model"}} as any;
  return s;
}

function makeBuilder(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    ready: true,
    busy: false,
    stopping: false,
    result: undefined,
    error: "",
    events: [], liveText: "", changes: [], workspace: undefined, projectReview: undefined,
    pickWorkspace:vi.fn(),undoChange:vi.fn(),applyProject:vi.fn(),
    generate: vi.fn(async () => {}),
    stop: vi.fn(),
    reject: vi.fn(),
    newChat: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  } as unknown as CodingAgent;
}

function proposal() {
  return {
    project: {}, text:"候选解释",
    modelApiCalled: false,
    generations: [],
    engine: "test",
  };
}

function panel(studio: Studio, builder: CodingAgent, review = vi.fn()) {
  return render(
    <BuilderPanel
      studio={studio}
      builder={builder}
      configureModel={review}
    />,
  );
}

it("renders saved chat as plain text and keeps the candidate while editing", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder({
    messages: [
      { id: "u1", role: "user", text: "Use <img src=x onerror=alert(1)>" },
      { id: "a1", role: "assistant", text: "准备审阅", status: "proposed" },
    ],
    result: proposal(), projectReview:{files:[{path:"project.json",before:"旧项目",after:"创建工具"}],permissions:[]},
  });
  const review = vi.fn();
  panel(studio, builder, review);

  expect(screen.getByText("Use <img src=x onerror=alert(1)>")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByRole("button", { name: "审阅候选差异" })).toBeTruthy();
  expect(screen.queryByLabelText("构建模型模式")).toBeNull();
  expect(screen.queryByLabelText("构建操作")).toBeNull();

  fireEvent.change(screen.getByLabelText("构建需求"), {
    target: { value: "Add a search tool" },
  });
  expect(builder.clear).not.toHaveBeenCalled();
  expect(screen.getByLabelText("项目修改").textContent).toContain("project.json");
  fireEvent.click(screen.getByRole("button", { name: "审阅候选差异" }));
  expect(screen.getByText("创建工具")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "舍弃项目修改" }));
  expect(builder.reject).toHaveBeenCalledOnce();
  expect(builder.clear).not.toHaveBeenCalled();
});

it("sends on Enter, keeps Shift+Enter for a newline, and does not send during IME composition", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder();
  panel(studio, builder);
  const input = screen.getByLabelText("构建需求");
  fireEvent.change(input, {
    target: { value: "Explain the selected project" },
  });

  fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });
  expect(builder.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true });
  expect(builder.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(builder.generate).toHaveBeenCalledOnce());
  expect(builder.generate).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: "Explain the selected project" }),
  );
  expect((input as HTMLTextAreaElement).value).toBe("");
});

it("shows real loading and stopping state and disables new chat while busy", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder({ busy: true, stopping: false });
  panel(studio, builder);

  expect(screen.getByRole("status").textContent).toContain(
    "正在处理任务",
  );
  const stop = screen.getByRole("button", { name: "停止" });
  const newChat = screen.getByRole("button", {
    name: "新对话",
  }) as HTMLButtonElement;
  expect(newChat.disabled).toBe(true);
  fireEvent.click(stop);
  expect(builder.stop).toHaveBeenCalledOnce();

  cleanup();
  const stoppingBuilder = makeBuilder({ busy: true, stopping: true });
  panel(studio, stoppingBuilder);
  expect(screen.getByRole("status").textContent).toContain("正在停止");
});

it("requires a configured model and exposes real file changes with undo", async () => {
  const studio=await readyStudio();studio.resources.map.clear();
  const builder=makeBuilder({changes:[{change:{changeId:"change-1",path:"src/main.ts",before:"old",after:"new",beforeDigest:"a".repeat(64),afterDigest:"b".repeat(64)},undone:false}],error:"BLK-CODING-CONFLICT"});
  panel(studio,builder);
  expect(screen.getAllByRole("alert").some(node=>node.textContent?.includes("模型"))).toBe(true);
  fireEvent.change(screen.getByLabelText("构建需求"),{target:{value:"修改代码"}});
  expect((screen.getByRole("button",{name:"发送"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"撤回 src/main.ts"}));
  expect(builder.undoChange).toHaveBeenCalledWith("change-1");
  expect(screen.getByText("src/main.ts")).toBeTruthy();
  expect(screen.queryByRole("checkbox",{name:"生成本地应用界面"})).toBeNull();
});

it("starts a new conversation when idle", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder({
    messages: [{ id: "a1", role: "assistant", text: "Old chat" }],
  });
  panel(studio, builder);
  fireEvent.click(screen.getByRole("button", { name: "新对话" }));
  expect(builder.newChat).toHaveBeenCalledOnce();
});
