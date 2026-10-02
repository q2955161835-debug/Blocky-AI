// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
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
import { modelResource } from "../fixtures/model-resource";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
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

it("opens model recovery without losing the draft and keeps file undo available", async () => {
  const studio=await readyStudio();studio.resources.map.clear();
  const builder=makeBuilder({changes:[{change:{changeId:"change-1",path:"src/main.ts",before:"old",after:"new",beforeDigest:"a".repeat(64),afterDigest:"b".repeat(64)},undone:false}],error:"BLK-CODING-CONFLICT"});
  panel(studio,builder);
  expect(screen.queryByRole("button",{name:"配置模型"})).toBeNull();
  fireEvent.change(screen.getByLabelText("构建需求"),{target:{value:"修改代码"}});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  expect(screen.getByRole("button",{name:"配置模型"})).toBeTruthy();
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe("修改代码");
  expect(builder.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog",{name:"构建助手设置"}),{key:"Escape"});
  fireEvent.click(screen.getByRole("button",{name:"撤回 src/main.ts"}));
  expect(builder.undoChange).toHaveBeenCalledWith("change-1");
  expect(screen.getByText("src/main.ts")).toBeTruthy();
  expect(screen.queryByRole("checkbox",{name:"生成本地应用界面"})).toBeNull();
});

it("keeps folders behind add, returns keyboard focus, and offers recovery for text-only models", async () => {
  const studio=await readyStudio();
  studio.resources.map.get("test-model")!.definition.capabilities=["text"];
  const builder=makeBuilder();
  panel(studio,builder);
  expect(screen.queryByText("你想构建什么？")).toBeNull();
  expect(screen.queryByRole("button",{name:"选择工作文件夹"})).toBeNull();
  const add=screen.getByRole("button",{name:"构建助手添加上下文"});
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("button",{name:"选择工作文件夹"}));
  expect(builder.pickWorkspace).toHaveBeenCalledOnce();
  fireEvent.click(add);
  fireEvent.keyDown(screen.getByRole("dialog",{name:"构建助手上下文"}),{key:"Escape"});
  expect(document.activeElement).toBe(add);
  fireEvent.change(screen.getByLabelText("构建需求"),{target:{value:"你好"}});
  fireEvent.keyDown(screen.getByLabelText("构建需求"),{key:"Enter"});
  expect(screen.getByRole("dialog",{name:"构建助手设置"}).textContent).toContain("工具调用");
  expect(builder.generate).not.toHaveBeenCalled();
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe("你好");
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

it("repairs a saved text-only model, preserves its connection and draft, then sends with that same model", async () => {
  const hook=renderHook(()=>useStudio());
  await waitFor(()=>expect(hook.result.current.resources.ready && hook.result.current.settings.ready).toBe(true));
  const provider={schemaVersion:"blocky.model-provider/v1",providerId:"shared",displayName:"息壤",adapter:"xirang",protocol:"openai-chat",revision:1,secretBindings:[{fieldId:"apiKey",secretRef:"saved-model-secret"}]};
  const model={...modelResource(),definition:{connectionRef:"shared",modelId:"deepseek-v4-pro",timeoutMs:60000,capabilities:["text"],parameters:{maxOutputTokens:512}},secretBindings:[]};
  await act(()=>hook.result.current.resources.upsertProvider(provider));
  await act(()=>hook.result.current.resources.upsert(model));
  act(()=>hook.result.current.settings.change("app","models.defaultResourceId","saved-model"));
  await act(()=>hook.result.current.settings.flush());
  const builder=makeBuilder();
  const view=panel(hook.result.current,builder);
  fireEvent.change(screen.getByLabelText("构建需求"),{target:{value:"你好，检查当前项目"}});
  fireEvent.click(screen.getByRole("button",{name:"发送"}));
  expect(builder.generate).not.toHaveBeenCalled();
  const storage=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("write failed");});
  fireEvent.click(screen.getByRole("button",{name:"启用工具调用"}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("未能保存"));
  expect(hook.result.current.resources.registry.resources[0].definition.capabilities).toEqual(["text"]);
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe("你好，检查当前项目");
  storage.mockRestore();
  fireEvent.click(screen.getByRole("button",{name:"启用工具调用"}));
  await waitFor(()=>expect(hook.result.current.resources.registry.resources[0].definition.capabilities).toEqual(["text","tools"]));
  expect(hook.result.current.resources.registry.resources[0]).toMatchObject({...model,definition:{...model.definition,capabilities:["text","tools"]}});
  expect(hook.result.current.resources.registry.providers).toEqual([provider]);
  view.rerender(<BuilderPanel studio={hook.result.current} builder={builder} configureModel={()=>{}} />);
  fireEvent.keyDown(screen.getByRole("dialog",{name:"构建助手设置"}),{key:"Escape"});
  fireEvent.keyDown(screen.getByLabelText("构建需求"),{key:"Enter"});
  expect(builder.generate).toHaveBeenCalledWith({prompt:"你好，检查当前项目",resourceId:"saved-model"});
});
