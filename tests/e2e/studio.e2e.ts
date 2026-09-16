/// <reference types="mocha" />
import { browser, $, $$, expect } from "@wdio/globals";
import { mkdir } from "node:fs/promises";
import {
  chromium,
  type Browser as CdpBrowser,
  type Page,
} from "playwright-core";
describe("Blocky native editor", () => {
  let cdp: CdpBrowser, page: Page;
  before(async () => {
    cdp = await chromium.connectOverCDP(
      `http://127.0.0.1:${process.env.BLOCKY_TEST_CDP_PORT}`,
    );
    page = cdp
      .contexts()[0]
      .pages()
      .find(
        (p) =>
          p.url().startsWith("http://tauri.localhost") ||
          p.url().startsWith("tauri://"),
      )!;
    if (!page) throw Error("Blocky test page not found");
    const errors = new Set<string>();
    page.on("console", (message) => {
      if (message.type() === "error" && !errors.has(message.text())) {
        errors.add(message.text());
        console.log("WEBVIEW_ERROR", message.text());
      }
    });
  });
  after(async () => {
    await cdp?.close().catch(() => {});
  });
  it("creates editable canvases, runs a sourced answer and navigates across modules", async () => {
    await $("button*=资料问答伙伴").click();
    await $(".blocklyDraggable").waitForDisplayed();
    await expect($("[aria-label='画布名称']")).toHaveValue("研究助手");
    await $(".project-toolbar button.primary").click();
    await $(".answer").waitForDisplayed();
    await expect($(".answer")).toHaveText(expect.stringContaining("叶绿素"));
    await expect($(".answer summary")).toHaveText(
      expect.stringContaining("资料来源"),
    );
    await $(".trace summary").click();
    const link = await $(
      "//details[contains(@class,'trace')]//button[contains(.,'lookup-entry')]",
    );
    await link.click();
    await expect($("[aria-label='画布名称']")).toHaveValue("引用服务");
    await $("[aria-label='返回上一位置']").click();
    await expect($("[aria-label='画布名称']")).toHaveValue("研究助手");
    await mkdir("try/stage2-e2e", { recursive: true });
    await browser.saveScreenshot("try/stage2-e2e/native-editor.png");
  });
  it("focuses the canvas after a blank click so Tab opens block search", async () => {
    const starter = page.getByRole("button", { name: /资料问答伙伴/ });
    if (await starter.isVisible()) await starter.click();
    const canvas = page.locator(".blockly-host");
    const background = page.locator(".blocklyMainBackground");
    const bounds = await background.boundingBox();
    if (!bounds) throw Error("Canvas background is not visible");
    await background.click({
      position: { x: bounds.width - 35, y: bounds.height - 50 },
    });
    expect(
      await canvas.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await page.getByRole("dialog", { name: "搜索积木" }).waitFor();
    await page.getByRole("button", { name: "关闭弹层" }).click();
    const name = page.getByLabel("画布名称");
    await name.click();
    await page.keyboard.press("Tab");
    expect(await page.getByRole("dialog", { name: "搜索积木" }).count()).toBe(
      0,
    );
  });
  it("opens shared commands, restores closed tabs and keeps two workspaces", async () => {
    await $("[aria-label='关闭 引用服务']").click();
    await $(
      "//aside[contains(@class,'library')]//button[contains(.,'引用服务')]",
    ).click();
    await expect($("[aria-label='画布名称']")).toHaveValue("引用服务");
    await $("button*=搜索命令").click();
    await $("[aria-label='命令搜索词']").setValue("运行日志");
    await $(
      "//div[contains(@class,'popup-list')]//button[contains(.,'运行日志')]",
    ).click();
    await expect($(".bottom-panel")).toBeDisplayed();
    await expect($$(".workspace-tabs > div")).toBeElementsArrayOfSize(2);
  });
  it("reviews explicit surface permissions, runs the actual isolated page and reopens its tab", async () => {
    await $(
      "//aside[contains(@class,'library')]//button[contains(.,'研究助手')]",
    ).click();
    await $("button=创建应用界面").click();
    await $("dialog[aria-label='审阅变更']").waitForDisplayed();
    await expect($("[aria-label='应用界面文件变更']")).toBeDisplayed();
    for (const checkbox of await $$(".permission-choice input"))
      await checkbox.click();
    await $("//dialog//button[contains(.,'接受变更')]").click();
    await $("iframe[title='资料问答']").waitForDisplayed();
    const frame = page.frameLocator("iframe[title='资料问答']");
    await page.screenshot({ path: "try/stage2-e2e/surface-loading.png" });
    const isolation = await frame.locator("body").evaluate(() => {
      let storage = false,
        cookie = false;
      try {
        localStorage.setItem("blocky-isolation-probe", "x");
        storage = true;
      } catch {}
      try {
        document.cookie = "blocky_isolation=x";
        cookie = document.cookie.includes("blocky_isolation");
      } catch {}
      return {
        storage,
        cookie,
        tauri: "__TAURI__" in window,
        internals: "__TAURI_INTERNALS__" in window,
        ipc: "ipc" in window,
      };
    });
    expect(isolation).toEqual({
      storage: false,
      cookie: false,
      tauri: false,
      internals: false,
      ipc: false,
    });
    await browser.tauri.execute(async ({ core }) =>
      core.invoke("append_diagnostics", {
        records: [
          {
            timestamp: "2026-09-16T00:00:00.000Z",
            sequence: 888888,
            level: "warning",
            channel: "preview",
          },
        ],
      }),
    );
    const denied = await frame.locator("body").evaluate(async () => {
      let parentAccess = false,
        httpReached = false;
      try {
        parentAccess = !!(parent as unknown as { __TAURI_INTERNALS__: unknown })
          .__TAURI_INTERNALS__;
      } catch {}
      const message = {
        cmd: "clear_diagnostics",
        callback: 1,
        error: 2,
        payload: {},
        __TAURI_INVOKE_KEY__: "fixture-invalid-invoke-key",
      };
      const native = window as unknown as {
        chrome?: { webview?: { postMessage(value: string): void } };
      };
      try {
        native.chrome?.webview?.postMessage(JSON.stringify(message));
      } catch {}
      try {
        await fetch("http://ipc.localhost/clear_diagnostics", {
          method: "POST",
          body: JSON.stringify(message),
        });
        httpReached = true;
      } catch {}
      return { parentAccess, httpReached };
    });
    expect(denied).toEqual({ parentAccess: false, httpReached: false });
    const preserved = await browser.tauri.execute(async ({ core }) => {
      const data = (await core.invoke("read_diagnostics", {
        channel: "preview",
      })) as { records: { sequence: number }[] };
      return data.records.some((r) => r.sequence === 888888);
    });
    expect(preserved).toBe(true);
    await frame.locator("#question").fill("水循环如何形成？");
    await frame.locator("#submit").click({ timeout: 15000 });
    try {
      await browser.waitUntil(
        async () =>
          (await frame.locator("#answer").innerText()).includes("蒸发"),
        { timeout: 15000 },
      );
    } catch (error) {
      console.log("SURFACE_RUN_STATE", {
        status: await frame.locator("#status").innerText(),
        answer: await frame.locator("#answer").innerText(),
        studio: await page.locator(".statusbar").innerText(),
      });
      await page.screenshot({ path: "try/stage2-e2e/surface-run-failure.png" });
      throw error;
    }
    expect(await frame.locator("#citations").innerText()).toContain("水循环");
    await browser.saveScreenshot("try/stage2-e2e/native-surface.png");
    await $("[aria-label='关闭 问答页面']").click();
    await expect($$("iframe")).toBeElementsArrayOfSize(0);
    await $(
      "//aside[contains(@class,'library')]//button[contains(.,'问答页面')]",
    ).click();
    await $("iframe[title='资料问答']").waitForDisplayed();
  });
  it("keeps a native task running behind a collapsed panel and exposes truncation and diagnostic controls", async () => {
    await $(
      "//div[contains(@class,'panel-tabs')]//button[normalize-space()='终端']",
    ).click();
    await $("[aria-label='任务检查次数']").setValue("20");
    await $("[aria-label='任务间隔']").setValue("100");
    await $("[aria-label='任务输出上限']").setValue("256");
    await $("button=运行检查").click();
    await $("[aria-label='折叠面板']").click();
    await $("[aria-label='展开面板']").click();
    await browser.waitUntil(
      async () =>
        (await $(".task-panel [role='status']").getText()).includes("检查通过"),
      { timeout: 15000 },
    );
    await expect($(".task-panel [role='status']")).toHaveText(
      expect.stringContaining("输出已截断"),
    );
    await $(
      "//div[contains(@class,'panel-tabs')]//button[normalize-space()='输出']",
    ).click();
    await page.getByLabel("输出通道").selectOption({ label: "terminal" });
    await expect($(".panel-body .log-row code")).toHaveText("terminal");
    await $("button=清除视图").click();
    await expect($$(".panel-body .log-row")).toBeElementsArrayOfSize(0);
    await browser.saveScreenshot("try/stage2-e2e/native-output.png");
  });
});
