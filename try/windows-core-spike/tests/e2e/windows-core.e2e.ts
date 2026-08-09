import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";
import type { InteractionManifest } from "../../src/core/interactionManifest";
import type { RuntimeEvent } from "../../src/core/runtimeEvents";
import type { SpikeProjectSnapshot } from "../../src/project/SpikeProjectSnapshot";

type HookRuntimeEvent = RuntimeEvent;

interface TestHook {
  getBlockCount(): number;
  loadHundredBlockFixture(): void;
  getCanonicalSnapshot(): SpikeProjectSnapshot;
  getManifest(): InteractionManifest;
  startSimulation(input: string): void;
  cancelSimulation(): void;
  readRedactedEvents(): HookRuntimeEvent[];
  readUsedJsHeapSize(): number | null;
}

interface HookWindow extends Window {
  __BLOCKY_SPIKE_TEST__: TestHook;
}

function collectBlockIds(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectBlockIds(item, found);
    return found;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string" && typeof record.id === "string") {
    found.add(record.id);
  }
  for (const child of Object.values(record)) collectBlockIds(child, found);
  return found;
}

function findBlock(value: unknown, id: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBlock(item, id);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.id === id && typeof record.type === "string") return record;
  for (const child of Object.values(record)) {
    const found = findBlock(child, id);
    if (found) return found;
  }
  return null;
}

function snapshotWorkspace(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== "object" || !("workspace" in snapshot)) {
    throw new Error("WDIO_SNAPSHOT_WORKSPACE_UNAVAILABLE");
  }
  return (snapshot as { workspace: unknown }).workspace;
}

async function getBlockCount(): Promise<number> {
  // Canonical workspace/IR state is not reliably observable from rendered SVG,
  // so this assertion-only bridge reads the wdio-only deterministic hook.
  return browser.tauri.execute(({ core: _core }) =>
    (window as unknown as HookWindow).__BLOCKY_SPIKE_TEST__.getBlockCount(),
  );
}

async function getCanonicalSnapshot(): Promise<unknown> {
  // The exact canonical snapshot cannot be reconstructed from visible labels.
  return browser.tauri.execute(({ core: _core }) =>
    (window as unknown as HookWindow).__BLOCKY_SPIKE_TEST__.getCanonicalSnapshot(),
  );
}

async function getManifest(): Promise<unknown> {
  // Manifest identity/capability assertions require the wdio-only compiled view.
  return browser.tauri.execute(({ core: _core }) =>
    (window as unknown as HookWindow).__BLOCKY_SPIKE_TEST__.getManifest(),
  );
}

async function waitForRustSave(projectId: string): Promise<void> {
  // The save button intentionally has no test-only completion signal. Polling
  // the real Rust load command is assertion-only and prevents clear racing disk IO.
  let lastProbe: unknown;
  try {
    await browser.waitUntil(async () => {
      lastProbe = await browser.tauri.execute(async ({ core }, nextProjectId) => {
        try {
          const record = await core.invoke("load_project", {
            projectId: nextProjectId,
          }) as {
            json?: unknown;
          };
          return { ok: typeof record.json === "string", type: typeof record.json };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      }, projectId);
      return Boolean((lastProbe as { ok?: boolean } | null)?.ok);
    });
  } catch (error) {
    throw new Error(`WDIO_RUST_SAVE_PROBE:${JSON.stringify(lastProbe)}`, {
      cause: error,
    });
  }
}

async function readEvents(): Promise<HookRuntimeEvent[]> {
  // Structured redacted events cannot be recovered losslessly from timeline text.
  return browser.tauri.execute(({ core: _core }) =>
    (window as unknown as HookWindow).__BLOCKY_SPIKE_TEST__.readRedactedEvents(),
  );
}

async function setControlledSelect(testId: string, value: string): Promise<void> {
  // Embedded WebDriver did not dispatch React's controlled-select change for
  // selectByAttribute, selectByVisibleText, or keyboard input. This narrowly
  // applies the native select setter plus a real bubbling change event.
  await browser.tauri.execute(({ core: _core }, nextTestId, nextValue) => {
    const select = document.querySelector<HTMLSelectElement>(`[data-testid='${nextTestId}']`);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    if (!select || !setter) throw new Error("WDIO_CONTROLLED_SELECT_UNAVAILABLE");
    setter.call(select, nextValue);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, testId, value);
}

async function eventsSinceLastStart(): Promise<HookRuntimeEvent[]> {
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

async function waitForTerminal(type: string): Promise<HookRuntimeEvent[]> {
  await browser.waitUntil(
    async () => (await eventsSinceLastStart()).at(-1)?.type === type,
    { timeout: 15_000, timeoutMsg: `未观察到终止事件 ${type}` },
  );
  return eventsSinceLastStart();
}

describe("Windows Core native channel", () => {
  it("drives the compiled Tauri executable through the complete Core contract", async () => {
    const builderTab = await $("aria/搭建助手");
    const runtimeTab = await $("aria/运行 Agent");
    await expect(builderTab).toBeEnabled();
    await expect(runtimeTab).toBeDisabled();

    await $("aria/载入100块").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 100);
    await expect(runtimeTab).toBeEnabled();
    await runtimeTab.click();

    const entrySelect = await $("[data-testid='runtime-entry-select']");
    await expect(entrySelect).toHaveValue("block-002");
    await expect(entrySelect).toHaveText(expect.stringContaining("Chat"));
    await expect(entrySelect).toHaveText(expect.stringContaining("Follow-up"));

    const textInput = await $("[data-testid='runtime-text-input']");
    await textInput.setValue("A 草稿");
    await expect($("[data-testid='runtime-add-image']")).toExist();
    await expect($("[data-testid='runtime-add-file']")).toExist();
    await expect($("[data-testid='runtime-add-voice']")).toExist();
    await expect($("[data-testid='runtime-skill-menu']")).toExist();
    await expect($("[data-testid='runtime-plugin-menu']")).toExist();

    await setControlledSelect("runtime-entry-select", "block-015");
    await expect(entrySelect).toHaveValue("block-015");
    await $("[data-testid='runtime-skill-menu'] option[value='history']").waitForExist();
    await setControlledSelect("runtime-skill-menu", "history");
    await expect($("[data-testid='runtime-text-input']")).not.toExist();
    await expect($("[data-testid='runtime-add-image']")).not.toExist();
    await expect($("[data-testid='runtime-add-file']")).not.toExist();
    await expect($("[data-testid='runtime-add-voice']")).not.toExist();
    await expect($("[data-testid='runtime-plugin-menu']")).not.toExist();
    await expect($("[data-testid='runtime-skill-menu']")).toHaveValue("history");
    await setControlledSelect("runtime-entry-select", "block-002");
    await expect(entrySelect).toHaveValue("block-002");
    await $("[data-testid='runtime-text-input']").waitForExist();
    await expect($("[data-testid='runtime-text-input']")).toHaveValue("A 草稿");
    await setControlledSelect("runtime-entry-select", "block-015");
    await expect(entrySelect).toHaveValue("block-015");
    await $("[data-testid='runtime-skill-menu'] option[value='history']").waitForExist();
    await expect($("[data-testid='runtime-skill-menu']")).toHaveValue("history");

    const manifest = await getManifest();
    expect(manifest).toMatchObject({
      schemaVersion: "blocky.interaction/v0-spike",
      entries: [
        { id: "block-002", displayName: "Chat" },
        { id: "block-015", displayName: "Follow-up" },
      ],
    });

    await $("aria/折叠首块").click();
    await browser.waitUntil(async () => (
      findBlock(snapshotWorkspace(await getCanonicalSnapshot()), "block-001")
        ?.collapsed === true
    ));
    await $("aria/放大画布").click();
    await $("aria/缩小画布").click();
    const beforeSave = await getCanonicalSnapshot();
    const beforeIds = [...collectBlockIds(beforeSave)].sort();
    expect(beforeIds).toHaveLength(100);
    expect(findBlock(snapshotWorkspace(beforeSave), "block-001"))
      .toMatchObject({ collapsed: true });

    await $("aria/保存").click();
    await browser.pause(500);
    const saveError = await $(".app-operation-error");
    if (await saveError.isExisting()) {
      throw new Error(`WDIO_SAVE_UI_ERROR:${await saveError.getText()}`);
    }
    await waitForRustSave("windows-core-spike");
    await $("aria/清空").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 0);
    await expect(runtimeTab).toBeDisabled();
    await $("aria/重开").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 100);
    const afterReload = await getCanonicalSnapshot();
    expect(JSON.stringify(afterReload)).toBe(JSON.stringify(beforeSave));
    expect([...collectBlockIds(afterReload)].sort()).toEqual(beforeIds);

    await runtimeTab.click();
    await $("[data-testid='runtime-text-input']").setValue("你好");
    await $("[data-testid='runtime-send']").click();
    await browser.waitUntil(async () => (await $(".blocklyHighlighted")).isExisting());
    const normalEvents = await waitForTerminal("run.completed");
    expect(normalEvents.filter((event) => event.type === "model.chunk").map(
      (event) => (event.data as { text: string }).text,
    )).toEqual([
      "已收到：",
      "你好",
    ]);
    expect(normalEvents.some((event) => event.type === "block.started")).toBe(true);

    await $("[data-testid='runtime-text-input']").setValue("取消我");
    await $("[data-testid='runtime-send']").click();
    await browser.waitUntil(async () => (await eventsSinceLastStart()).some((event) => event.type === "block.started"));
    await $("aria/取消运行").click();
    const cancelledEvents = await waitForTerminal("run.cancelled");
    expect(cancelledEvents.some((event) => event.type === "run.completed")).toBe(false);

    await $("[data-testid='runtime-text-input']").setValue("/error");
    await $("[data-testid='runtime-send']").click();
    const errorEvents = await waitForTerminal("run.failed");
    expect(errorEvents.at(-1)).toMatchObject({
      type: "run.failed",
      blockId: "block-001",
      data: { code: "MODEL_SIMULATED_FAILURE" },
    });

    await $("[data-testid='runtime-text-input']").setValue("/permission");
    await $("[data-testid='runtime-send']").click();
    const permissionDialog = await $("aria/工具权限请求");
    await permissionDialog.waitForDisplayed();
    await expect(permissionDialog).toHaveText(expect.stringContaining("tool.weather"));
    await expect(permissionDialog).toHaveText(expect.stringContaining("无额外权限"));
    await $("aria/拒绝").click();
    const deniedEvents = await waitForTerminal("run.failed");
    expect(deniedEvents.some((event) => event.type === "tool.started")).toBe(false);

    await $("[data-testid='runtime-text-input']").setValue("/permission");
    await $("[data-testid='runtime-send']").click();
    await $("aria/工具权限请求").waitForDisplayed();
    await $("aria/批准").click();
    const approvedEvents = await waitForTerminal("run.completed");
    expect(approvedEvents.some((event) => event.type === "tool.completed")).toBe(true);

    // Replacing browser networking constructors cannot be expressed with DOM actions;
    // this setup-only execution makes every outbound attempt fail synchronously.
    await browser.tauri.execute(({ core: _core }) => {
      const originalFetch = window.fetch.bind(window);
      const outboundAttempts: string[] = [];
      Object.assign(window, { __BLOCKY_OUTBOUND_ATTEMPTS__: outboundAttempts });
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        const parsed = new URL(raw, window.location.href);
        if (parsed.protocol === "http:" && parsed.host === "ipc.localhost") {
          return originalFetch(input, init);
        }
        outboundAttempts.push(`${parsed.protocol}//${parsed.host}`);
        throw new Error("OUTBOUND_FETCH_BLOCKED");
      }) as typeof window.fetch;
      window.XMLHttpRequest = class BlockedXmlHttpRequest {
        constructor() {
          outboundAttempts.push("xhr://constructor");
          throw new Error("OUTBOUND_XHR_BLOCKED");
        }
      } as unknown as typeof window.XMLHttpRequest;
      window.WebSocket = class BlockedWebSocket {
        constructor() {
          outboundAttempts.push("websocket://constructor");
          throw new Error("OUTBOUND_WEBSOCKET_BLOCKED");
        }
      } as unknown as typeof window.WebSocket;
    });

    await $("aria/清空").click();
    await $("aria/重开").click();
    await browser.waitUntil(async () => (await getBlockCount()) === 100);
    await runtimeTab.click();
    await $("[data-testid='runtime-text-input']").setValue("断网运行");
    await $("[data-testid='runtime-send']").click();
    const offlineEvents = await waitForTerminal("run.completed");
    expect(offlineEvents.filter((event) => event.type === "model.chunk")).toHaveLength(2);
    // The external-attempt ledger is assertion-only state installed above;
    // Tauri's fixed ipc.localhost transport is intentionally not outbound.
    const outboundAttempts = await browser.tauri.execute(({ core: _core }) =>
      (window as unknown as { __BLOCKY_OUTBOUND_ATTEMPTS__?: string[] })
        .__BLOCKY_OUTBOUND_ATTEMPTS__ ?? [],
    );
    expect(outboundAttempts).toEqual([]);
  });
});
