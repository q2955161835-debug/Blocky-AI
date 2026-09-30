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
import type { Builder } from "../../apps/studio-desktop/src/composition/useBuilder";
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
  return hook.result.current;
}

function makeBuilder(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    ready: true,
    busy: false,
    stopping: false,
    result: undefined,
    error: "",
    evidence: undefined,
    generate: vi.fn(async () => {}),
    stop: vi.fn(),
    reject: vi.fn(),
    newChat: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  } as unknown as Builder;
}

function proposal() {
  return {
    spec: { plan: ["创建工具"], acceptanceCriteria: ["工具可完成查询"] },
    patch: {},
    explanation: "候选解释",
    modelApiCalled: false,
    generations: [],
    engine: "test",
  };
}

function panel(studio: Studio, builder: Builder, review = vi.fn()) {
  return render(
    <BuilderPanel
      studio={studio}
      builder={builder}
      createSurface={false}
      setCreateSurface={vi.fn()}
      review={review}
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
    result: proposal(),
  });
  const review = vi.fn();
  panel(studio, builder, review);

  expect(screen.getByText("Use <img src=x onerror=alert(1)>")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByRole("button", { name: "审阅候选差异" })).toBeTruthy();
  expect(screen.getByLabelText("构建模型模式")).toBeTruthy();
  expect(screen.getByLabelText("构建操作")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("构建需求"), {
    target: { value: "Add a search tool" },
  });
  expect(builder.clear).not.toHaveBeenCalled();
  expect(screen.getByLabelText("构建方案").textContent).toContain("创建工具");
  fireEvent.click(screen.getByRole("button", { name: "审阅候选差异" }));
  expect(review).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "拒绝方案" }));
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
    "正在生成并验证候选",
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

it("keeps failed model-call evidence readable without a candidate result", async () => {
  const studio = await readyStudio();
  const builder = makeBuilder({
    error: "BLK-BUILDER-LOCAL-LIMIT",
    evidence: {
      requestId: "request-failed",
      outcome: "validation-rejected",
      attempts: [
        {
          turn: 1,
          outcome: "validation-rejected",
          response: {
            model: "test-model",
            responseId: "response-failed",
            inputTokens: 17,
            outputTokens: 5,
            totalTokens: 22,
          },
        },
      ],
    },
  });
  panel(studio, builder);

  expect(screen.getByRole("alert").textContent).toContain(
    "BLK-BUILDER-LOCAL-LIMIT",
  );
  const evidenceSummary = screen.getByText("本次调用记录");
  expect(screen.getAllByText("本次调用记录")).toHaveLength(1);
  fireEvent.click(evidenceSummary);
  expect(
    screen.getByText(/test-model · 22 Token · response-failed/),
  ).toBeTruthy();
  expect(screen.queryByRole("article", { name: "构建方案" })).toBeNull();
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
