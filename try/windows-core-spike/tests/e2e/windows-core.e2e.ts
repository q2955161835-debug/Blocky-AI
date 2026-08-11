import { resolve } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";
import type { InteractionManifest } from "../../src/core/interactionManifest";
import type { RuntimeEvent } from "../../src/core/runtimeEvents";
import type { SpikeProjectSnapshot } from "../../src/project/SpikeProjectSnapshot";

interface WorkspaceViewState {
  readonly scale: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly topBlocks: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}

interface TestHook {
  getBlockCount(): number;
  loadHundredBlockFixture(): void;
  loadVisualAcceptanceWorkspace(): void;
  readWorkspaceViewState(): WorkspaceViewState;
  readTopLevelOverlapPairs(): readonly string[];
  getCanonicalSnapshot(): SpikeProjectSnapshot;
  getManifest(): InteractionManifest;
  readRedactedEvents(): RuntimeEvent[];
}

type HookWindow = Omit<Window, "__BLOCKY_SPIKE_TEST__"> & {
  __BLOCKY_SPIKE_TEST__: TestHook;
};

async function callHook<T>(method: keyof TestHook): Promise<T> {
  return browser.tauri.execute(({ core: _core }, nextMethod) => {
    const hook = (window as unknown as HookWindow).__BLOCKY_SPIKE_TEST__;
    const operation = hook[nextMethod] as () => T;
    return operation();
  }, method);
}

async function getBlockCount(): Promise<number> {
  return callHook<number>("getBlockCount");
}

async function readWorkspaceViewState(): Promise<WorkspaceViewState> {
  return callHook<WorkspaceViewState>("readWorkspaceViewState");
}

async function readTopLevelOverlapPairs(): Promise<readonly string[]> {
  return callHook<readonly string[]>("readTopLevelOverlapPairs");
}

async function readEvents(): Promise<RuntimeEvent[]> {
  return callHook<RuntimeEvent[]>("readRedactedEvents");
}

async function eventsSinceLastStart(): Promise<RuntimeEvent[]> {
  const events = await readEvents();
  let start = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "run.started") {
      start = index;
      break;
    }
  }
  return start < 0 ? [] : events.slice(start);
}

async function waitForTerminal(type: RuntimeEvent["type"]): Promise<RuntimeEvent[]> {
  await browser.waitUntil(
    async () => (await eventsSinceLastStart()).at(-1)?.type === type,
    { timeout: 15_000, timeoutMsg: `未观察到终止事件 ${type}` },
  );
  return eventsSinceLastStart();
}

async function loadHundredBlockFixture(): Promise<void> {
  await callHook<void>("loadHundredBlockFixture");
  await browser.waitUntil(async () => (await getBlockCount()) === 100);
}

describe("Blocky professional native workbench", () => {
  it("drives the real Tauri UI without exposing obsolete test controls", async () => {
    await expect($("aria/搭建助手")).toHaveAttribute("aria-selected", "true");
    await expect($("aria/对话测试")).toBeEnabled();
    await expect($("aria/搜索积木和命令")).toExist();
    await expect($("aria/选择工具 (V)")).toHaveAttribute("aria-pressed", "true");
    expect(await browser.execute(() => document.body.innerText)).not.toMatch(
      /Windows Core|技术尖峰|载入100块|折叠首块|运行 Agent/,
    );
    expect(await $("aria/运行").isExisting()).toBe(false);
    expect(await $(".blocklyTrash").isExisting()).toBe(false);
    const initialLayout = await browser.execute(() => {
      const zoom = document.querySelector(".canvas-controls__zoom")
        ?.getBoundingClientRect();
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        zoomBottom: zoom?.bottom ?? Number.POSITIVE_INFINITY,
      };
    });
    expect(initialLayout).toMatchObject({ width: 1536, height: 843 });
    expect(initialLayout.zoomBottom).toBeLessThanOrEqual(initialLayout.height);

    await loadHundredBlockFixture();
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    const beforeCollapse = await readWorkspaceViewState();

    await $("aria/收起积木栏").click();
    await $("aria/收起右侧面板").click();
    await $("aria/展开积木栏").waitForDisplayed();
    await $("aria/展开右侧面板").waitForDisplayed();
    await browser.waitUntil(async () =>
      JSON.stringify(await readWorkspaceViewState()) === JSON.stringify(beforeCollapse),
    );
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    await $("aria/展开积木栏").click();
    await $("aria/展开右侧面板").click();

    const initialScale = (await readWorkspaceViewState()).scale;
    const search = await $("aria/搜索积木和命令");
    await search.click();
    await search.setValue("放大");
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () =>
      (await readWorkspaceViewState()).scale > initialScale,
    );

    await search.click();
    await search.setValue("智能体 成员");
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () => (await getBlockCount()) === 101);
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    await $("aria/撤销").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 100);

    await $("aria/平移工具 (H)").click();
    await expect($("aria/平移工具 (H)")).toHaveAttribute("aria-pressed", "true");
    await browser.keys(["v"]);
    await expect($("aria/选择工具 (V)")).toHaveAttribute("aria-pressed", "true");

    const manifest = await callHook<InteractionManifest>("getManifest");
    expect(manifest).toMatchObject({
      schemaVersion: "blocky.interaction/v0-spike",
      entries: [
        { id: "block-002", displayName: "Chat" },
        { id: "block-015", displayName: "Follow-up" },
      ],
    });

    await $("aria/对话测试").click();
    const input = await $("aria/发送给 Agent");
    await input.setValue("你好");
    await browser.keys(["Enter"]);
    const completed = await waitForTerminal("run.completed");
    expect(completed.filter((event) => event.type === "model.chunk").map(
      (event) => (event.data as { text: string }).text,
    )).toEqual(["已收到：", "你好"]);
    await expect($(".conversation-message--user")).toHaveText("你好");
    await expect($(".conversation-message--assistant")).toHaveText("已收到：你好");
    const traceToggle = await $("button.conversation-trace__toggle");
    await expect(traceToggle).toHaveAttribute("aria-expanded", "false");
    await traceToggle.click();
    await $(".conversation-trace__item").waitForDisplayed();
    const tracePresentation = await browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(
        ".conversation-trace__item",
      )];
      return {
        categories: [...new Set(rows.map((row) => row.dataset.category))],
        colours: rows.map((row) => row.style.getPropertyValue("--event-colour")),
      };
    });
    expect(tracePresentation.categories.length).toBeGreaterThanOrEqual(2);
    expect(tracePresentation.colours.every((colour) => colour.length > 0)).toBe(true);
    await browser.saveScreenshot(resolve(
      process.cwd(),
      "../../doc/技术设计/Windows-Core视觉验收/13-professional-conversation-trace.png",
    ));
    await traceToggle.click();
    const productText = await browser.execute(() => document.body.innerText);
    expect(productText).not.toMatch(/block-001|blocky\.event|run\.completed/);

    await input.setValue("/permission");
    await browser.keys(["Enter"]);
    await $("aria/工具权限请求").waitForDisplayed();
    await $("aria/拒绝").click();
    const denied = await waitForTerminal("run.failed");
    expect(denied.some((event) => event.type === "tool.started")).toBe(false);

    await input.setValue("/permission");
    await browser.keys(["Enter"]);
    await $("aria/工具权限请求").waitForDisplayed();
    await $("aria/批准").click();
    const approved = await waitForTerminal("run.completed");
    expect(approved.some((event) => event.type === "tool.completed")).toBe(true);

    const visualDir = resolve(process.cwd(), "../../doc/技术设计/Windows-Core视觉验收");
    await callHook<void>("loadVisualAcceptanceWorkspace");
    await browser.waitUntil(async () => (await getBlockCount()) === 3);
    await $("aria/搭建助手").click();
    await expect($("aria/画布积木数量")).toHaveText("画布 · 3 个积木");
    const visualState = await readWorkspaceViewState();
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    await browser.saveScreenshot(resolve(visualDir, "11-professional-workbench-expanded.png"));

    await $("aria/收起积木栏").click();
    await $("aria/收起右侧面板").click();
    await browser.waitUntil(async () =>
      JSON.stringify(await readWorkspaceViewState()) === JSON.stringify(visualState),
    );
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    await browser.saveScreenshot(resolve(visualDir, "12-professional-workbench-collapsed.png"));
  });
});
