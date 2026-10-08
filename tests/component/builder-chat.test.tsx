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
import { BuilderPanel } from "../fixtures/ChatPanelHarness";
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
  const s = hook.result.current;
  s.resources.map.set("test-model", {
    resourceId: "test-model",
    kind: "model",
    scope: "user",
    displayName: "测试模型",
    definition: {
      provider: "deepseek",
      protocol: "openai-chat",
      modelId: "test",
      capabilities: ["text", "tools"],
      implementationRef: "adapter://deepseek-v1",
    },
    secretBindings: [{ fieldId: "apiKey", secretRef: "synthetic-ref" }],
  } as any);
  s.settings.layers.app = {
    schemaVersion: "blocky.settings/v1",
    scope: "app",
    values: { "models.defaultResourceId": "test-model" },
  } as any;
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
    events: [],
    liveText: "",
    changes: [],
    workspace: undefined,
    projectReview: undefined,
    pickWorkspace: vi.fn(),
    undoChange: vi.fn(),
    applyProject: vi.fn(),
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
    project: {},
    text: "候选解释",
    modelApiCalled: false,
    generations: [],
    engine: "test",
  };
}

function panel(studio: Studio, builder: CodingAgent, review = vi.fn()) {
  return render(
    <BuilderPanel studio={studio} builder={builder} configureModel={review} />,
  );
}
it("reopens thought and CLI metadata under their own cancelled reply without duplicating the next reply", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder({
    messages: [
      {
        id: "cancelled-reply",
        role: "assistant",
        text: "已分析部分正文\n\n已停止本轮任务。",
        status: "cancelled",
        thinking: "检查依赖 <img src=x>",
        thinkingTruncated: true,
        activity: [
          {
            callId: "cli-run",
            tool: "blocky_cli",
            status: "completed",
            command: "blocky project validate",
            exitCode: 0,
          },
        ],
        activityTruncated: 3,
      },
      {
        id: "next-reply",
        role: "assistant",
        text: "下一轮独立回答",
        status: "completed",
      },
    ],
  });
  panel(studio, builder);
  const trace = screen.getByRole("region", { name: "构建助手调用轨迹" });
  const reply = trace.closest("li")!;
  expect(reply.textContent).toContain("已分析部分正文");
  expect(reply.textContent).not.toContain("下一轮独立回答");
  expect(trace.querySelector("img")).toBeNull();
  expect(trace.textContent).toContain("检查依赖 <img src=x>");
  expect(trace.textContent).toContain("思考记录已截断");
  expect(trace.textContent).toContain("3 项较早操作已裁剪");
  expect(trace.textContent).toContain("blocky project validate");
  expect(trace.textContent).toContain("退出码 0");
  expect(
    screen.getAllByRole("region", { name: "构建助手调用轨迹" }),
  ).toHaveLength(1);
});

it("keeps user input literal and the candidate while editing", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder({
    messages: [
      { id: "u1", role: "user", text: "Use <img src=x onerror=alert(1)>" },
      { id: "a1", role: "assistant", text: "准备审阅", status: "proposed" },
    ],
    result: proposal(),
    projectReview: {
      files: [{ path: "project.json", before: "旧项目", after: "创建工具" }],
      permissions: [],
      status: "conflict",
    },
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
  expect(screen.getByLabelText("项目修改").textContent).toContain(
    "project.json",
  );
  fireEvent.click(screen.getByRole("button", { name: "审阅候选差异" }));
  expect(screen.getByText("创建工具")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "舍弃项目修改" }));
  expect(builder.reject).toHaveBeenCalledOnce();
  expect(builder.clear).not.toHaveBeenCalled();
});

it("formats saved assistant Markdown while preserving literal user input", async () => {
  const studio = await readyStudio();
  const markdown =
    "## 🧩 项目操作\n\n- **查看项目**：使用 `project inspect`\n- 编译项目\n\n> 保留当前画布\n\n---";
  panel(
    studio,
    makeBuilder({
      messages: [
        { id: "u-markdown", role: "user", text: "## **原始输入**" },
        {
          id: "a-markdown",
          role: "assistant",
          text: markdown,
          status: "completed",
        },
      ],
    }),
  );
  expect(
    screen.getByRole("heading", { level: 2, name: "🧩 项目操作" }),
  ).toBeTruthy();
  const thread = screen.getByLabelText("构建助手聊天记录");
  expect(screen.getByText("查看项目").tagName).toBe("STRONG");
  expect(thread.querySelector("code")?.textContent).toBe("project inspect");
  expect(thread.querySelector("blockquote")?.textContent).toContain(
    "保留当前画布",
  );
  expect(thread.querySelector("hr")).toBeTruthy();
  expect(screen.getByText("## **原始输入**")).toBeTruthy();
});

it("formats streaming replies and their final history with tables and code", async () => {
  const studio = await readyStudio();
  const text =
    "## 结果\n\n| 工具 | 状态 |\n| --- | --- |\n| CLI | 完成 |\n\n```js\nconst markup = '<img src=x>';\n```";
  const view = panel(studio, makeBuilder({ liveText: text, busy: true }));
  expect(
    screen.getByLabelText("正在回复").querySelector("h2")?.textContent,
  ).toBe("结果");
  expect(screen.getByRole("cell", { name: "完成" })).toBeTruthy();
  expect(
    screen.getByLabelText("正在回复").querySelector("pre code")?.textContent,
  ).toBe("const markup = '<img src=x>';\n");
  view.rerender(
    <BuilderPanel
      studio={studio}
      builder={makeBuilder({
        messages: [
          { id: "a-final", role: "assistant", text, status: "completed" },
        ],
      })}
      configureModel={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("正在回复")).toBeNull();
  expect(screen.getByRole("heading", { name: "结果" })).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
});

it("never executes reply HTML or loads Markdown images and only links public web or mail URLs", async () => {
  const studio = await readyStudio();
  const text =
    "<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[危险](javascript:alert%281%29) [本地](file:///secret.txt) [相对](/settings) [官网](https://example.com)\n\n![说明](https://example.com/tracker.png)";
  panel(
    studio,
    makeBuilder({
      messages: [
        { id: "a-unsafe", role: "assistant", text, status: "completed" },
      ],
    }),
  );
  const thread = screen.getByLabelText("构建助手聊天记录");
  expect(thread.querySelector("script, img, iframe")).toBeNull();
  expect(screen.queryByRole("link", { name: "危险" })).toBeNull();
  expect(screen.queryByRole("link", { name: "本地" })).toBeNull();
  expect(screen.queryByRole("link", { name: "相对" })).toBeNull();
  expect(screen.getByRole("link", { name: "官网" }).getAttribute("href")).toBe(
    "https://example.com",
  );
  expect(screen.getByText("说明")).toBeTruthy();
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

  expect(screen.getByRole("status").textContent).toContain("正在处理任务");
  const stop = screen.getByRole("button", { name: "停止" });
  const newChat = screen.getByRole("button", {
    name: "构建助手新会话",
  }) as HTMLButtonElement;
  expect(newChat.disabled).toBe(true);
  fireEvent.click(stop);
  expect(builder.stop).toHaveBeenCalledOnce();

  cleanup();
  const stoppingBuilder = makeBuilder({ busy: true, stopping: true });
  panel(studio, stoppingBuilder);
  expect(screen.getByRole("status").textContent).toContain("正在停止");
});

it("groups tool calls inside the reply flow and replaces a running call with its final state", async () => {
  const studio = await readyStudio();
  const base = {
    schemaVersion: "blocky.coding-event/v1",
    requestId: "request-test",
    projectId: studio.snapshot.project.manifest.projectId,
  };
  const builder = makeBuilder({
    messages: [{ id: "a1", role: "assistant", text: "我会检查文件。" }],
    busy: true,
    events: [
      {
        ...base,
        sequence: 1,
        kind: "tool.started",
        tool: "workspace_read",
        callId: "call-1",
      },
      {
        ...base,
        sequence: 2,
        kind: "tool.completed",
        tool: "workspace_read",
        callId: "call-1",
      },
      {
        ...base,
        sequence: 3,
        kind: "tool.failed",
        tool: "workspace_write",
        callId: "call-2",
        code: "BLK-CODING-CONFLICT",
      },
    ],
  });
  panel(studio, builder);
  const dialogue = screen.getByLabelText("构建助手聊天记录");
  const trace = screen.getByRole("region", { name: "构建助手调用轨迹" });
  expect(dialogue.textContent).toContain("我会检查文件。");
  expect(dialogue.contains(trace)).toBe(true);
  expect(trace.querySelectorAll("li")).toHaveLength(2);
  expect(trace.textContent).toContain("读取文件 · 已完成");
  expect(trace.textContent).toContain("编辑文件 · 失败（BLK-CODING-CONFLICT）");
  expect(trace.querySelector("details")?.open).toBe(false);
  fireEvent.click(screen.getByText("调用轨迹 · 2 项操作"));
  expect(trace.querySelector("details")?.open).toBe(true);
});

it("opens model recovery without losing the draft and keeps file undo available", async () => {
  const studio = await readyStudio();
  studio.resources.map.clear();
  const builder = makeBuilder({
    changes: [
      {
        change: {
          changeId: "change-1",
          path: "src/main.ts",
          before: "old",
          after: "new",
          beforeDigest: "a".repeat(64),
          afterDigest: "b".repeat(64),
        },
        undone: false,
      },
    ],
    error: "BLK-CODING-CONFLICT",
  });
  panel(studio, builder);
  expect(screen.queryByRole("button", { name: "配置模型" })).toBeNull();
  fireEvent.change(screen.getByLabelText("构建需求"), {
    target: { value: "修改代码" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(screen.getByRole("button", { name: "配置模型" })).toBeTruthy();
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe(
    "修改代码",
  );
  expect(builder.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog", { name: "构建助手设置" }), {
    key: "Escape",
  });
  fireEvent.click(screen.getByRole("button", { name: "撤回 src/main.ts" }));
  expect(builder.undoChange).toHaveBeenCalledWith("change-1");
  expect(screen.getByText("src/main.ts")).toBeTruthy();
  expect(
    screen.queryByRole("checkbox", { name: "生成本地应用界面" }),
  ).toBeNull();
});

it("keeps folders behind add, returns keyboard focus, and offers recovery for text-only models", async () => {
  const studio = await readyStudio();
  studio.resources.map.get("test-model")!.definition.capabilities = ["text"];
  const builder = makeBuilder();
  panel(studio, builder);
  expect(screen.queryByText("你想构建什么？")).toBeNull();
  expect(screen.queryByRole("button", { name: "选择工作文件夹" })).toBeNull();
  const add = screen.getByRole("button", { name: "构建助手添加上下文" });
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("button", { name: "选择工作文件夹" }));
  expect(builder.pickWorkspace).toHaveBeenCalledOnce();
  fireEvent.click(add);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "构建助手上下文" }), {
    key: "Escape",
  });
  expect(document.activeElement).toBe(add);
  fireEvent.change(screen.getByLabelText("构建需求"), {
    target: { value: "你好" },
  });
  fireEvent.keyDown(screen.getByLabelText("构建需求"), { key: "Enter" });
  expect(
    screen.getByRole("dialog", { name: "构建助手设置" }).textContent,
  ).toContain("工具调用");
  expect(builder.generate).not.toHaveBeenCalled();
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe(
    "你好",
  );
});

it("starts a new conversation when idle", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder({
    messages: [{ id: "a1", role: "assistant", text: "Old chat" }],
  });
  panel(studio, builder);
  fireEvent.click(screen.getByRole("button", { name: "构建助手新会话" }));
  expect(builder.newChat).toHaveBeenCalledOnce();
});

it("repairs a saved text-only model, preserves its connection and draft, then sends with that same model", async () => {
  const hook = renderHook(() => useStudio());
  await waitFor(() =>
    expect(
      hook.result.current.resources.ready && hook.result.current.settings.ready,
    ).toBe(true),
  );
  const provider = {
    schemaVersion: "blocky.model-provider/v1",
    providerId: "shared",
    displayName: "息壤",
    adapter: "xirang",
    protocol: "openai-chat",
    revision: 1,
    secretBindings: [{ fieldId: "apiKey", secretRef: "saved-model-secret" }],
  };
  const model = {
    ...modelResource(),
    definition: {
      connectionRef: "shared",
      modelId: "deepseek-v4-pro",
      timeoutMs: 60000,
      capabilities: ["text"],
      parameters: { maxOutputTokens: 512 },
    },
    secretBindings: [],
  };
  await act(() => hook.result.current.resources.upsertProvider(provider));
  await act(() => hook.result.current.resources.upsert(model));
  act(() =>
    hook.result.current.settings.change(
      "app",
      "models.defaultResourceId",
      "saved-model",
    ),
  );
  await act(() => hook.result.current.settings.flush());
  const builder = makeBuilder();
  const view = panel(hook.result.current, builder);
  fireEvent.change(screen.getByLabelText("构建需求"), {
    target: { value: "你好，检查当前项目" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(builder.generate).not.toHaveBeenCalled();
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw Error("write failed");
    });
  fireEvent.click(screen.getByRole("button", { name: "启用工具调用" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("未能保存"),
  );
  expect(
    hook.result.current.resources.registry.resources[0].definition.capabilities,
  ).toEqual(["text"]);
  expect((screen.getByLabelText("构建需求") as HTMLTextAreaElement).value).toBe(
    "你好，检查当前项目",
  );
  storage.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "启用工具调用" }));
  await waitFor(() =>
    expect(
      hook.result.current.resources.registry.resources[0].definition
        .capabilities,
    ).toEqual(["text", "tools"]),
  );
  expect(hook.result.current.resources.registry.resources[0]).toMatchObject({
    ...model,
    definition: { ...model.definition, capabilities: ["text", "tools"] },
  });
  expect(hook.result.current.resources.registry.providers).toEqual([provider]);
  view.rerender(
    <BuilderPanel
      studio={hook.result.current}
      builder={builder}
      configureModel={() => {}}
    />,
  );
  fireEvent.keyDown(screen.getByRole("dialog", { name: "构建助手设置" }), {
    key: "Escape",
  });
  fireEvent.keyDown(screen.getByLabelText("构建需求"), { key: "Enter" });
  expect(builder.generate).toHaveBeenCalledWith({
    prompt: "你好，检查当前项目",
    resourceId: "saved-model",
    reasoningEffort: "none",
  });
});
