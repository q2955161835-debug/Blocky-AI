/// <reference types="mocha" />
import { browser, $, $$, expect } from "@wdio/globals";
import { mkdir } from "node:fs/promises";
describe("Blocky native editor", () => {
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
    const link = await $("//details[contains(@class,'trace')]//button[contains(.,'lookup-entry')]");
    await link.click();
    await expect($("[aria-label='画布名称']")).toHaveValue("引用服务");
    await $("[aria-label='返回上一位置']").click();
    await expect($("[aria-label='画布名称']")).toHaveValue("研究助手");
    await mkdir("try/stage1-e2e", { recursive: true });
    await browser.saveScreenshot("try/stage1-e2e/native-editor.png");
  });
  it("opens shared commands, restores closed tabs and keeps two workspaces", async () => {
    await $("[aria-label='关闭 引用服务']").click();
    await $("//aside[contains(@class,'library')]//button[contains(.,'引用服务')]").click();
    await expect($("[aria-label='画布名称']")).toHaveValue("引用服务");
    await $("button*=搜索命令").click();
    await $("[aria-label='命令搜索词']").setValue("运行日志");
    await $("//div[contains(@class,'popup-list')]//button[contains(.,'运行日志')]").click();
    await expect($(".bottom-panel")).toBeDisplayed();
    await expect($$(".workspace-tabs > div")).toBeElementsArrayOfSize(2);
  });
});
