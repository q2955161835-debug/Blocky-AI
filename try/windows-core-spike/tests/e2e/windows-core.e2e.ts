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

const KEY = Object.freeze({
  Alt: "\uE00A",
  Ctrl: "\uE009",
  Delete: "\uE017",
  Enter: "\uE007",
  Escape: "\uE00C",
  Shift: "\uE008",
  Space: "\uE00D",
});

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

type DocumentDialogFixture =
  | "cancel"
  | "roundTrip"
  | "saveFailure"
  | "invalidZip"
  | "pathTraversal"
  | "unsupportedVersion"
  | "derivedMismatch";

async function prepareDocumentDialog(fixture: DocumentDialogFixture): Promise<void> {
  await browser.tauri.execute(async ({ core }, nextFixture) => {
    await core.invoke("wdio_prepare_document_dialog", { fixture: nextFixture });
  }, fixture);
}

async function requestNativeWindowClose(): Promise<void> {
  await browser.tauri.execute(async ({ core }) => {
    await core.invoke("wdio_request_window_close");
  });
}

async function pressShortcut(...keys: string[]): Promise<void> {
  const action = browser.action("key");
  for (const key of keys) action.down(key);
  for (const key of [...keys].reverse()) action.up(key);
  await action.perform();
}

async function titleText(): Promise<string> {
  return browser.execute(() =>
    document.querySelector<HTMLElement>(".desktop-titlebar__drag-region")
      ?.innerText.trim() ?? "",
  );
}

async function clickFileMenuItem(label: string): Promise<void> {
  await $("aria/文件").click();
  await $(`//button[@role='menuitem'][.//span[normalize-space()=${JSON.stringify(label)}]]`)
    .click();
}

async function selectedBlockCount(): Promise<number> {
  return browser.execute(() =>
    document.querySelectorAll('[data-blocky-selected="true"]').length,
  );
}

async function pointerClick(
  element: ReturnType<typeof $>,
  shiftKey = false,
): Promise<void> {
  await browser.execute((target, additive) => {
    const bounds = target.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 72,
      pointerType: "mouse",
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
      shiftKey: additive,
    };
    target.dispatchEvent(new PointerEvent("pointerdown", {
      ...options,
      button: 0,
      buttons: 1,
    }));
    target.dispatchEvent(new PointerEvent("pointerup", {
      ...options,
      button: 0,
      buttons: 0,
    }));
  }, element, shiftKey);
}

async function pointerDragViewport(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): Promise<void> {
  await browser.execute(async (from, to) => {
    const origin = document.querySelector(".blockly-canvas");
    if (!origin) throw new Error("POINTER_ORIGIN_UNAVAILABLE");
    const down = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 71,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: from.x,
      clientY: from.y,
    });
    origin.dispatchEvent(down);
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    const move = new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 71,
      pointerType: "mouse",
      button: -1,
      buttons: 1,
      clientX: to.x,
      clientY: to.y,
    });
    origin.dispatchEvent(move);
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    const up = new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 71,
      pointerType: "mouse",
      button: 0,
      buttons: 0,
      clientX: to.x,
      clientY: to.y,
    });
    origin.dispatchEvent(up);
  }, start, end);
}

async function dispatchWheel(
  selector: string,
  deltaY: number,
): Promise<{ readonly cancelled: boolean; readonly tag: string; readonly className: string }> {
  return browser.execute((targetSelector, nextDeltaY) => {
    const target = document.querySelector(targetSelector);
    if (!target) throw new Error("WHEEL_TARGET_UNAVAILABLE");
    const rect = target.getBoundingClientRect();
    const dispatched = target.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaX: 0,
      deltaY: nextDeltaY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    }));
    return {
      cancelled: !dispatched,
      tag: target.tagName,
      className: target.getAttribute("class") ?? "",
    };
  }, selector, deltaY);
}

async function focusControl(name: string): Promise<void> {
  const focused = await browser.execute((accessibleName) => {
    const candidates = [...document.querySelectorAll<HTMLElement>(
      "button, input, textarea, select, [tabindex]",
    )];
    const target = candidates.find((candidate) =>
      !candidate.hasAttribute("disabled") &&
      (candidate.getAttribute("aria-label") ??
        candidate.getAttribute("placeholder") ??
        candidate.innerText.trim()) === accessibleName,
    );
    target?.focus();
    return target !== undefined && document.activeElement === target;
  }, name);
  if (!focused) throw new Error(`KEYBOARD_FOCUS_TARGET_UNAVAILABLE:${name}`);
}

async function createFinalCloseSentinel(): Promise<void> {
  await browser.tauri.execute(async ({ core }) => {
    await core.invoke("wdio_create_close_sentinel");
  });
}

async function clearBrowserTextSelection(): Promise<void> {
  await browser.execute(() => window.getSelection()?.removeAllRanges());
}

async function setCssViewport(
  width: number,
  height: number,
): Promise<{ readonly width: number; readonly height: number; readonly dpr: number }> {
  let requestedWidth = width;
  let requestedHeight = height;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await browser.setWindowSize(requestedWidth, requestedHeight);
    await browser.pause(50);
    const actual = await browser.execute(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    }));
    if (actual.width === width && actual.height === height) return actual;
    requestedWidth += Math.round((width - actual.width) * actual.dpr);
    requestedHeight += Math.round((height - actual.height) * actual.dpr);
  }
  const actual = await browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  throw new Error(
    `CSS_VIEWPORT_MISMATCH:${width}x${height}:${JSON.stringify(actual)}`,
  );
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

    // Drive the ordinary file UI through the real Tauri IPC and a test-only,
    // path-opaque native dialog selection. The production build has neither
    // the command nor the fixture capability.
    expect(await titleText()).toBe("未命名 Agent · 未保存");
    await prepareDocumentDialog("cancel");
    await clickFileMenuItem("另存为…");
    await browser.pause(100);
    expect(await titleText()).toBe("未命名 Agent · 未保存");

    await prepareDocumentDialog("roundTrip");
    await clickFileMenuItem("另存为…");
    await browser.waitUntil(async () => (await titleText()) === "lifecycle.blocky · 已保存");

    await $("aria/智能体 成员").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 1);
    await pressShortcut(KEY.Ctrl, "s");
    await browser.waitUntil(async () => (await titleText()) === "lifecycle.blocky · 已保存");

    await $("aria/智能体 成员").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 2);
    await browser.waitUntil(async () => (await titleText()) === "lifecycle.blocky · 未保存");
    await pressShortcut(KEY.Ctrl, "n");
    await $("aria/保存更改？").waitForDisplayed();
    await $("aria/取消").click();
    expect(await getBlockCount()).toBe(2);
    await pressShortcut(KEY.Ctrl, "n");
    await $("aria/不保存").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 0);
    expect(await titleText()).toBe("未命名 Agent · 未保存");

    await prepareDocumentDialog("roundTrip");
    await pressShortcut(KEY.Ctrl, "o");
    await $("aria/保存更改？").waitForDisplayed();
    await $("aria/不保存").click();
    await browser.waitUntil(async () => (await titleText()) === "lifecycle.blocky · 已保存");
    expect(await getBlockCount()).toBe(1);
    const validSnapshot = await callHook<SpikeProjectSnapshot>("getCanonicalSnapshot");

    for (const fixture of [
      "invalidZip",
      "pathTraversal",
      "unsupportedVersion",
      "derivedMismatch",
    ] as const) {
      await prepareDocumentDialog(fixture);
      await pressShortcut(KEY.Ctrl, "o");
      await expect($("aria/无法打开项目文件，当前文档未更改")).toBeDisplayed();
      expect(await callHook<SpikeProjectSnapshot>("getCanonicalSnapshot"))
        .toEqual(validSnapshot);
      expect(await titleText()).toBe("lifecycle.blocky · 已保存");
    }

    await pressShortcut(KEY.Ctrl, "n");
    await browser.waitUntil(async () => (await getBlockCount()) === 0);
    expect(await titleText()).toBe("未命名 Agent · 未保存");
    await $("aria/智能体 成员").click();
    await browser.waitUntil(async () => (await titleText()) === "未命名 Agent · 未保存");
    await pressShortcut(KEY.Ctrl, "n");
    await $("aria/保存更改？").waitForDisplayed();
    await prepareDocumentDialog("saveFailure");
    await $("aria/保存并继续").click();
    await expect($("aria/无法保存项目文件，请检查文件后重试")).toBeDisplayed();
    await expect($("aria/保存更改？")).toBeDisplayed();
    expect(await getBlockCount()).toBe(1);
    await $("aria/不保存").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 0);

    await requestNativeWindowClose();
    await $("aria/保存更改？").waitForDisplayed();
    await $("aria/取消").click();
    await expect($("aria/Blocky")).toExist();

    // Exercise native WebView pointer/wheel events rather than creating blocks
    // through the WDIO hook. Click insertion, pointer drag, marquee, Shift selection,
    // clipboard, Delete, wheel zoom and temporary Space pan all go through the
    // same DOM event path used by a person.
    const libraryBlock = await $("aria/智能体 成员");
    await libraryBlock.click();
    await browser.waitUntil(async () => (await getBlockCount()) === 1);
    await browser.execute(() => {
      const source = document.querySelector<HTMLElement>(
        ".block-library__item[aria-label='智能体 成员']",
      );
      const target = document.querySelector<HTMLElement>(".blockly-canvas");
      if (!source || !target) throw new Error("LIBRARY_DRAG_TARGET_UNAVAILABLE");
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const start = {
        x: sourceRect.left + sourceRect.width / 2,
        y: sourceRect.top + sourceRect.height / 2,
      };
      const end = {
        x: targetRect.left + targetRect.width * 0.62,
        y: targetRect.top + targetRect.height * 0.32,
      };
      source.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 63,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: start.x,
        clientY: start.y,
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 63,
        pointerType: "mouse",
        button: -1,
        buttons: 1,
        clientX: end.x,
        clientY: end.y,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 63,
        pointerType: "mouse",
        button: 0,
        buttons: 0,
        clientX: end.x,
        clientY: end.y,
      }));
    });
    await browser.waitUntil(async () => (await getBlockCount()) === 2);
    expect(await readTopLevelOverlapPairs()).toEqual([]);

    const beforeWheel = await readWorkspaceViewState();
    const wheelDispatch = await dispatchWheel(".blockly-canvas", -420);
    await browser.pause(100);
    const afterWheelDispatch = await readWorkspaceViewState();
    if (Math.abs(afterWheelDispatch.scale - beforeWheel.scale) <= 0.000_001) {
      throw new Error(`WHEEL_ZOOM_UNCHANGED:${JSON.stringify(wheelDispatch)}`);
    }
    const afterCanvasWheel = await readWorkspaceViewState();
    await expect($("aria/当前画布缩放")).toHaveText(
      `${Math.round(afterCanvasWheel.scale * 100)}%`,
    );
    await dispatchWheel(".block-palette__list", 320);
    expect((await readWorkspaceViewState()).scale).toBe(afterCanvasWheel.scale);

    const marquee = await browser.execute(() => {
      const canvasRect = document.querySelector(".blockly-canvas")
        ?.getBoundingClientRect();
      if (!canvasRect) return null;
      return {
        start: {
          x: canvasRect.left + 8,
          y: canvasRect.bottom - 120,
        },
        end: {
          x: canvasRect.right - 8,
          y: canvasRect.top + 8,
        },
      };
    });
    if (!marquee) throw new Error("MARQUEE_GEOMETRY_UNAVAILABLE");
    await pointerDragViewport(marquee.start, marquee.end);
    await browser.pause(100);
    const marqueeCount = await selectedBlockCount();
    if (marqueeCount !== 2) {
      throw new Error(`MARQUEE_SELECTION_COUNT:${marqueeCount}`);
    }

    await browser.keys([KEY.Escape]);
    await browser.waitUntil(async () => (await selectedBlockCount()) === 0);
    const blockElements = await $$(".blocklyDraggable");
    const firstBlock = blockElements[0];
    const secondBlock = blockElements[1];
    if (!firstBlock || !secondBlock) throw new Error("POINTER_BLOCKS_UNAVAILABLE");
    await pointerClick(firstBlock);
    expect(await selectedBlockCount()).toBe(1);
    await pointerClick(secondBlock, true);
    expect(await selectedBlockCount()).toBe(2);

    await pressShortcut(KEY.Ctrl, "c");
    await pressShortcut(KEY.Ctrl, "v");
    await browser.waitUntil(async () => (await getBlockCount()) === 4);
    await browser.waitUntil(async () => (await selectedBlockCount()) === 2);
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    await $("aria/编辑").click();
    const deleteCommand = await $("//button[@role='menuitem'][.//span[normalize-space()='删除']]");
    await deleteCommand.waitForEnabled();
    await $("aria/编辑").click();
    await pressShortcut(KEY.Delete);
    await browser.waitUntil(async () => (await getBlockCount()) === 2);
    await $("aria/撤销").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 4);
    await $("aria/重做").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 2);
    await pressShortcut(KEY.Ctrl, "a");
    expect(await selectedBlockCount()).toBe(2);
    await browser.keys([KEY.Escape]);
    expect(await selectedBlockCount()).toBe(0);

    const beforeSpacePan = await readWorkspaceViewState();
    const panPoints = await browser.execute(() => {
      const rect = document.querySelector(".blockly-canvas")?.getBoundingClientRect();
      if (!rect) return null;
      return {
        start: { x: rect.right - 180, y: rect.bottom - 160 },
        end: { x: rect.right - 100, y: rect.bottom - 110 },
      };
    });
    if (!panPoints) throw new Error("PAN_GEOMETRY_UNAVAILABLE");
    await browser.action("key").down(KEY.Space).perform(true);
    await pointerDragViewport(panPoints.start, panPoints.end);
    await browser.action("key").up(KEY.Space).perform();
    const afterSpacePan = await readWorkspaceViewState();
    expect(afterSpacePan.scale).toBe(beforeSpacePan.scale);
    expect(afterSpacePan.topBlocks).toEqual(beforeSpacePan.topBlocks);
    expect({ x: afterSpacePan.scrollX, y: afterSpacePan.scrollY }).not.toEqual({
      x: beforeSpacePan.scrollX,
      y: beforeSpacePan.scrollY,
    });

    await loadHundredBlockFixture();
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    await clearBrowserTextSelection();
    const scrollbarPresentation = await browser.execute(() => {
      const verticalTrack = document.querySelector<SVGElement>(
        ".blocklyScrollbarVertical",
      );
      const verticalThumb = document.querySelector<SVGRectElement>(
        ".blocklyScrollbarVertical .blocklyScrollbarHandle",
      );
      const horizontalTrack = document.querySelector<SVGElement>(
        ".blocklyScrollbarHorizontal",
      );
      const horizontalThumb = document.querySelector<SVGRectElement>(
        ".blocklyScrollbarHorizontal .blocklyScrollbarHandle",
      );
      if (!verticalTrack || !verticalThumb || !horizontalTrack || !horizontalThumb) {
        return null;
      }
      const verticalTrackBounds = verticalTrack.getBoundingClientRect();
      const verticalThumbBounds = verticalThumb.getBoundingClientRect();
      const horizontalTrackBounds = horizontalTrack.getBoundingClientRect();
      const horizontalThumbBounds = horizontalThumb.getBoundingClientRect();
      return {
        verticalTrackWidth: verticalTrackBounds.width,
        verticalThumbWidth: verticalThumbBounds.width,
        verticalInset: verticalThumbBounds.left - verticalTrackBounds.left,
        horizontalTrackHeight: horizontalTrackBounds.height,
        horizontalThumbHeight: horizontalThumbBounds.height,
        horizontalInset: horizontalThumbBounds.top - horizontalTrackBounds.top,
        fillOpacity: getComputedStyle(verticalThumb).fillOpacity,
      };
    });
    expect(scrollbarPresentation).not.toBeNull();
    expect(scrollbarPresentation?.verticalTrackWidth).toBeGreaterThanOrEqual(15);
    expect(scrollbarPresentation?.verticalThumbWidth).toBeCloseTo(6, 0);
    expect(scrollbarPresentation?.verticalInset).toBeGreaterThanOrEqual(4);
    expect(scrollbarPresentation?.horizontalTrackHeight).toBeGreaterThanOrEqual(15);
    expect(scrollbarPresentation?.horizontalThumbHeight).toBeCloseTo(6, 0);
    expect(scrollbarPresentation?.horizontalInset).toBeGreaterThanOrEqual(4);
    expect(scrollbarPresentation?.fillOpacity).toBe("0.62");
    await browser.saveScreenshot(resolve(
      process.cwd(),
      "../../doc/技术设计/Windows-Core视觉验收/19-thin-canvas-scrollbars.png",
    ));
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
    await clearBrowserTextSelection();
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
    await browser.waitUntil(async () => (await input.getValue()) === "", {
      timeoutMsg: "授权运行完成后输入草稿未清空",
    });

    // Keyboard-only core path plus the two approved product viewports. The
    // current Windows host runs at 125% DPI, so the screenshot pixels also
    // prove a high-DPI native render rather than a browser-only resize.
    await setCssViewport(1440, 900);
    await browser.saveScreenshot(resolve(
      process.cwd(),
      "../../doc/技术设计/Windows-Core视觉验收/15-professional-workbench-1440x900.png",
    ));

    await setCssViewport(1180, 720);
    const compactLayout = await browser.execute(() => {
      const selectors = [
        ".desktop-titlebar",
        ".command-center",
        ".canvas-tool-controls",
        ".canvas-controls__primary",
        ".canvas-controls__zoom",
        ".assistant-panel",
      ];
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        bounds: selectors.map((selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return rect ? {
            selector,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          } : null;
        }),
      };
    });
    expect(compactLayout.width).toBe(1180);
    expect(compactLayout.height).toBe(720);
    expect(compactLayout.devicePixelRatio).toBeGreaterThan(1);
    await browser.saveScreenshot(resolve(
      process.cwd(),
      "../../doc/技术设计/Windows-Core视觉验收/16-professional-workbench-1180x720-high-dpi.png",
    ));
    const compactBoundsFit = compactLayout.bounds.every((bounds) =>
      bounds !== null &&
      bounds.left >= 0 && bounds.top >= 0 &&
      bounds.right <= compactLayout.width && bounds.bottom <= compactLayout.height
    );
    if (!compactBoundsFit) {
      throw new Error(`COMPACT_LAYOUT_OVERFLOW:${JSON.stringify(compactLayout)}`);
    }

    const keyboardFocusOrder = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )].map((control) =>
        control.getAttribute("aria-label") ??
          control.getAttribute("placeholder") ??
          control.innerText.trim(),
      ),
    );
    const builderFocusIndex = keyboardFocusOrder.indexOf("搭建助手");
    const runtimeFocusIndex = keyboardFocusOrder.indexOf("对话测试");
    const inputFocusIndex = keyboardFocusOrder.indexOf("发送给 Agent");
    expect(builderFocusIndex).toBeGreaterThan(-1);
    expect(runtimeFocusIndex).toBeGreaterThan(builderFocusIndex);
    expect(inputFocusIndex).toBeGreaterThan(runtimeFocusIndex);

    await focusControl("搭建助手");
    await browser.keys([KEY.Enter]);
    await expect($("aria/搭建助手")).toHaveAttribute("aria-selected", "true");
    await focusControl("对话测试");
    await browser.keys([KEY.Enter]);
    await expect($("aria/对话测试")).toHaveAttribute("aria-selected", "true");
    await focusControl("发送给 Agent");
    await browser.keys("键盘验收");
    await browser.keys([KEY.Enter]);
    await waitForTerminal("run.completed");
    const keyboardMessage = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".conversation-message--user")]
        .at(-1)?.innerText.trim() ?? "",
    );
    expect(keyboardMessage).toBe("键盘验收");

    const beforeKeyboardInsert = await getBlockCount();
    await pressShortcut(KEY.Ctrl, "p");
    await browser.keys("智能体 成员");
    await browser.keys([KEY.Enter]);
    await browser.waitUntil(async () => (await getBlockCount()) === beforeKeyboardInsert + 1);
    await pressShortcut(KEY.Ctrl, "a");
    expect(await selectedBlockCount()).toBeGreaterThan(0);
    await pressShortcut(KEY.Ctrl, "c");
    await pressShortcut(KEY.Ctrl, "v");
    expect(await readTopLevelOverlapPairs()).toEqual([]);
    await prepareDocumentDialog("roundTrip");
    await pressShortcut(KEY.Ctrl, KEY.Shift, "s");
    await browser.waitUntil(async () => (await titleText()) === "lifecycle.blocky · 已保存");

    await setCssViewport(1536, 843);

    const visualDir = resolve(process.cwd(), "../../doc/技术设计/Windows-Core视觉验收");
    await callHook<void>("loadVisualAcceptanceWorkspace");
    await browser.waitUntil(async () => (await getBlockCount()) === 3);
    await $("aria/搭建助手").click();
    await clearBrowserTextSelection();
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

    // Leave the destructive close path to the very end: the real application
    // window must disappear after the user explicitly discards dirty changes.
    await $("aria/展开积木栏").click();
    await $("aria/智能体 成员").click();
    await browser.waitUntil(async () => (await titleText()).endsWith("· 未保存"));
    // A hidden, test-only native window keeps the WDIO service alive after
    // the production main window is destroyed. Normal builds never compile
    // this sentinel, so their last-window process exit semantics are unchanged.
    await createFinalCloseSentinel();
    await requestNativeWindowClose();
    await $("aria/保存更改？").waitForDisplayed();
    await $("aria/不保存").click();
    await browser.waitUntil(async () => {
      const handles = await browser.getWindowHandles();
      return handles.length === 1 && handles[0] === "wdio-close-sentinel";
    }, {
      timeout: 5_000,
      timeoutMsg: "点击不保存后原生窗口仍然存在",
    });
  });
});
