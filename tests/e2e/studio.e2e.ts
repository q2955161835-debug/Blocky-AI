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
  it("navigates the real canvas with outline and overview without editing the project", async () => {
    await page.waitForFunction(() => !!(window as any).__BLOCKY_ACCEPTANCE__);
    await page.evaluate(() => (window as any).__BLOCKY_ACCEPTANCE__.loadLegacyRegressionProject());
    const overview = page.getByLabel("画布导航", { exact: true });
    await overview.locator(".overview-block").first().waitFor();
    const before = await page.evaluate(() => (window as any).__BLOCKY_ACCEPTANCE__.overviewState());
    await overview.getByText(/画布大纲 ·/).click();
    await overview.getByLabel("查找画布积木").fill("on-question");
    expect(await overview.locator(".canvas-outline button").count()).toBe(1);
    await overview.locator(".canvas-outline button").click();
    await page.waitForFunction(() => {
      const selected = document.querySelector(".blocklySelected > .blocklyPath")?.getBoundingClientRect();
      const canvas = document.querySelector(".blockly-host")?.getBoundingClientRect();
      if (!selected || !canvas) return false;
      const x = selected.left + selected.width / 2, y = selected.top + selected.height / 2;
      return x >= canvas.left && x <= canvas.right && y >= canvas.top && y <= canvas.bottom;
    });
    const map = overview.getByRole("img", { name: "画布位置概览" });
    const box = await map.boundingBox();
    if (!box) throw Error("Missing minimap bounds");
    const target = await overview.locator(".overview-block").first().evaluate(rect => ({
      x: Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2,
      y: Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2,
      width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")),
    }));
    // The viewport outline intentionally overlays the block; use its observed screen point.
    const blockBox = await overview.locator(".overview-block").first().boundingBox();
    if (!blockBox) throw Error("Missing minimap block bounds");
    await page.mouse.click(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2);
    await page.waitForFunction(target => {
      const rect = document.querySelector(".overview-viewport");
      return rect && Math.abs(Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2 - target.x) <= target.tolerance &&
        Math.abs(Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2 - target.y) <= target.tolerance;
    // Native pointer coordinates are quantized; allow one screen pixel of minimap precision.
    }, { ...target, tolerance: Math.max(target.width / blockBox.width, target.height / blockBox.height) }, { timeout: 3000 }).catch(async error => {
      console.log("OVERVIEW_CENTER", JSON.stringify({ target, actual: await page.evaluate(() => (window as any).__BLOCKY_ACCEPTANCE__.overviewState()) }));
      throw error;
    });
    const after = await page.evaluate(() => (window as any).__BLOCKY_ACCEPTANCE__.overviewState());
    expect(after.digest).toBe(before.digest);
    await mkdir("try/stage7/native", { recursive: true });
    await page.screenshot({ path: "try/stage7/native/canvas-overview.png" });
  });
  it("opens a starter and preserves legacy multi-module runtime and navigation behavior", async () => {
    await page
      .locator(".welcome")
      .getByRole("button", { name: /资料问答伙伴/ })
      .click();
    await $(".blocklyDraggable").waitForDisplayed();
    // Existing editor/preview regression uses its declared deterministic fixture.
    // Stage 3 real-source and starter delivery have separate native/CLI evidence.
    await page.waitForFunction(() => !!(window as any).__BLOCKY_ACCEPTANCE__);
    await page.evaluate(() =>
      (window as any).__BLOCKY_ACCEPTANCE__.loadLegacyRegressionProject(),
    );
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
    const starter = page
      .locator(".welcome")
      .getByRole("button", { name: /资料问答伙伴/ });
    if (await starter.isVisible()) await starter.click();
    const canvas = page.locator(".blockly-host");
    const background = page.locator(".blocklyMainBackground");
    const blank = await background.evaluate((el) => {
      const r = el.getBoundingClientRect();
      for (
        let y = r.top + 20;
        y < Math.min(r.bottom, innerHeight) - 20;
        y += 25
      )
        for (
          let x = r.left + 20;
          x < Math.min(r.right, innerWidth) - 20;
          x += 25
        )
          if (document.elementFromPoint(x, y) === el) return { x, y };
      return null;
    });
    if (!blank) throw Error("No observed blank canvas point");
    await page.mouse.click(blank.x, blank.y);
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
  it("generates a local builder proposal, renders actual readonly blocks, rejects and accepts with undo", async () => {
    await page.evaluate(() =>
      (window as any).__BLOCKY_ACCEPTANCE__.loadLegacyRegressionProject(),
    );
    await page
      .getByRole("button", { name: "Blocky 构建助手", exact: true })
      .click();
    await page.getByLabel("构建需求").fill("植物课堂助手");
    await page.getByRole("button", { name: "生成方案", exact: true }).click();
    try {
      await page
        .getByRole("button", { name: "审阅候选差异", exact: true })
        .waitFor({ timeout: 30000 });
    } catch (error) {
      console.log(
        "BUILDER_UI_FAILURE",
        await page.getByRole("dialog", { name: "Blocky 构建助手" }).innerText(),
      );
      await page.getByRole("button", { name: "关闭构建助手" }).click();
      throw error;
    }
    await page
      .getByRole("button", { name: "审阅候选差异", exact: true })
      .click();
    await page
      .locator('[aria-label="只读积木画布"] .blocklyBlockCanvas')
      .first()
      .waitFor();
    expect(
      await page.locator('[aria-label="只读积木画布"] .blocklyPath').count(),
    ).toBeGreaterThan(0);
    await page.getByRole("button", { name: "拒绝", exact: true }).click();
    await page
      .getByRole("button", { name: "Blocky 构建助手", exact: true })
      .click();
    await page.getByLabel("构建需求").fill("植物课堂助手");
    await page.getByRole("button", { name: "生成方案", exact: true }).click();
    await page
      .getByRole("button", { name: "审阅候选差异", exact: true })
      .click({ timeout: 30000 });
    await page.getByRole("button", { name: "接受变更", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector(".statusbar")?.textContent?.includes("已应用"),
    );
    await page.keyboard.press("Control+z");
  });
  it("opens a previously accepted legacy surface, runs the isolated page and reopens its tab", async () => {
    await $(
      "//aside[contains(@class,'library')]//button[contains(.,'研究助手')]",
    ).click();
    expect(
      await page.evaluate(() =>
        (window as any).__BLOCKY_ACCEPTANCE__.loadSurfaceRegressionProject(),
      ),
    ).toMatchObject({ same: true });
    try {
      await $("iframe[title='资料问答']").waitForDisplayed();
    } catch (error) {
      console.log(
        "SURFACE_ACCEPT_FAILURE",
        await page.locator("dialog").allTextContents(),
        await page.locator(".statusbar").innerText(),
      );
      await page.screenshot({
        path: "try/stage4/native/surface-accept-failure.png",
      });
      throw error;
    }
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
            timestamp: new Date().toISOString(),
            sequence: 888888,
            level: "warning",
            channel: "preview",
          },
        ],
      }),
    );
    const seeded = await browser.tauri.execute(async ({ core }) => {
      const data = (await core.invoke("read_diagnostics", {
        channel: "preview",
      })) as { records: { sequence: number }[] };
      return data.records.some((r) => r.sequence === 888888);
    });
    expect(seeded).toBe(true);
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
    await $("[aria-label='关闭 资料问答']").click();
    await expect($$("iframe")).toBeElementsArrayOfSize(0);
    await page.locator(".library").getByRole("button", { name: "◉ 资料问答", exact: true }).click();
    try {
      await $("iframe[title='资料问答']").waitForDisplayed();
    } catch (error) {
      console.log(
        "SURFACE_ACCEPT_FAILURE",
        await page.locator("dialog").allTextContents(),
        await page.locator(".statusbar").innerText(),
      );
      await page.screenshot({
        path: "try/stage4/native/surface-accept-failure.png",
      });
      throw error;
    }
  });
  it("operates a generated task page with attachment, approval, progress, viewport and preview lifecycle", async () => {
    expect(
      await page.evaluate(() =>
        (window as any).__BLOCKY_ACCEPTANCE__.loadSurfaceRegressionProject(
          true,
        ),
      ),
    ).toMatchObject({ same: true });
    const frame = page.frameLocator('iframe[title="学习资料查询"]');
    await frame.getByLabel("问题", { exact: true }).fill("水循环如何形成？");
    await frame.locator("#attachment").setInputFiles({
      name: "class-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("课堂笔记：观察蒸发与降水。"),
    });
    await frame.getByRole("button", { name: "查询资料", exact: true }).click();
    await page
      .getByRole("dialog", { name: "运行应用页面" })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.waitForFunction(() => document.querySelector("iframe") !== null);
    await browser.waitUntil(async () =>
      (await frame.locator("#status").innerText()).includes("未能完成"),
    );
    await frame.getByRole("button", { name: "查询资料", exact: true }).click();
    await page
      .getByRole("button", { name: "允许本次运行", exact: true })
      .click();
    await browser.waitUntil(
      async () => (await frame.locator("#answer").innerText()).includes("蒸发"),
      { timeout: 15000 },
    );
    for (const viewport of ["mobile", "tablet", "desktop"]) {
      await page.getByLabel("预览视口", { exact: true }).selectOption(viewport);
      expect(await frame.locator("#submit").isVisible()).toBe(true);
      const width = await frame.locator("body").evaluate(() => innerWidth);
      expect(width).toBe(
        viewport === "mobile" ? 390 : viewport === "tablet" ? 768 : 1280,
      );
      if (viewport === "mobile")
        expect(
          (await page.locator("iframe").boundingBox())!.width,
        ).toBeLessThanOrEqual(390);
    }
    await mkdir("try/stage5/native", { recursive: true });
    await page.screenshot({ path: "try/stage5/native/generated-surface.png" });
    await page.getByRole("button", { name: "停止预览", exact: true }).click();
    expect(await page.locator("iframe").count()).toBe(0);
    await page.getByRole("button", { name: "启动预览", exact: true }).click();
    await frame.locator("#submit").waitFor();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await frame.locator("#submit").waitFor();
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
  it("runs stage 4 conditional JSON output and saves new semantics through native storage", async () => {
    const stored = await page.evaluate(() =>
      (window as any).__BLOCKY_ACCEPTANCE__.loadAgentSemanticsProject(),
    );
    expect(stored).toEqual({ same: true, minimumReaderVersion: "0.4.0" });
    await page
      .locator(".run-panel")
      .getByRole("button", { name: "▶ 运行", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector(".answer pre")?.textContent?.includes("true"),
    );
    expect(await page.locator(".answer pre").innerText()).toContain(
      '"ok": true',
    );
    await page.getByLabel("向 Agent 提问").fill("no");
    await page
      .locator(".run-panel")
      .getByRole("button", { name: "▶ 运行", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector(".answer pre")?.textContent?.includes("false"),
    );
    expect(await page.locator(".answer pre").innerText()).toContain(
      '"ok": false',
    );
    await mkdir("try/stage4/native", { recursive: true });
    await page.screenshot({
      path: "try/stage4/native/structured-branches.png",
    });
  });
  it("creates an architecture starter and retains state through desktop input runs", async () => {
    await page.reload();
    await page.getByLabel("架构起点").getByRole("button", { name: /有限状态机/ }).click();
    await page.locator(".blocklyDraggable").first().waitFor();
    expect(await page.getByLabel("画布名称").inputValue()).toBe("有限状态机");
    for (const [input, expected] of [["start", "running"], ["finish", "done"], ["start", "done"]]) {
      await page.getByLabel("向 Agent 提问").fill(input);
      const run = page.locator(".run-panel").getByRole("button", { name: "▶ 运行", exact: true });
      await run.click();
      await page.waitForFunction(expected => document.querySelector(".answer pre")?.textContent === JSON.stringify(expected), expected);
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".run-actions button.primary")?.disabled);
    }
    await mkdir("try/stage7/native", { recursive: true });
    await page.screenshot({ path: "try/stage7/native/state-machine.png" });
  });
  it("renders four code badges and persistent markers without modifying the project", async () => {
    await page.waitForFunction(() => !!(window as any).__BLOCKY_ACCEPTANCE__);
    const before = await page.evaluate(() => (window as any).__BLOCKY_ACCEPTANCE__.loadCodeStateProject());
    for (const [state, label] of [["official-default", "✓ 官方默认"], ["custom-valid", "✓ 已自定义"], ["warning", "⚠ 代码警告"], ["invalid", "✖ 代码无效"]]) {
      const block = page.locator(`.blocklyDraggable[data-code-state="${state}"]`);
      expect(await block.count()).toBe(1);
      expect((await block.locator(".blocky-code-badge").textContent())?.replace(/\s/g, " ")).toBe(label);
      expect(await block.locator(":scope > .blocky-code-marker").count()).toBe(1);
    }
    const after = await page.evaluate(() => (window as any).__BLOCKY_ACCEPTANCE__.overviewState());
    expect(after.digest).toBe(before.digest);
    expect(before.canRun).toBe(false);
    expect(before.invalid).toBe(true);
    await mkdir("try/stage7/native", { recursive: true });
    await page.screenshot({ path: "try/stage7/native/code-states.png" });
  });
});
