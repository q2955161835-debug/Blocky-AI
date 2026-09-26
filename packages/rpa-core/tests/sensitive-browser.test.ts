import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { BrowserRpaAdapter, rpaPlanSchema } from "../src";

it.skipIf(process.env.BLOCKY_RPA_SENSITIVE_HEADLESS !== "1")("uses a real browser password control only for approved fill and does not return its value", async () => {
  const root = resolve("try/stage7/sensitive-browser-test");
  await mkdir(root, { recursive: true });
  const oldTemp = process.env.TEMP, oldTmp = process.env.TMP;
  process.env.TEMP = root; process.env.TMP = root;
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<input role="textbox" aria-label="Password" type="password"><output id="events">0</output><script>document.querySelector("input").oninput=()=>document.querySelector("output").textContent=String(Number(document.querySelector("output").textContent)+1)</script>' }));
    await page.goto("https://sensitive.test/");
    const parsed = rpaPlanSchema.parse({ schemaVersion: "blocky.rpa/v1", planId: "sensitive", target: { kind: "browser", identity: "https://sensitive.test" }, steps: [{ stepId: "fill", action: "fill", locator: { kind: "browser", role: "textbox", name: "Password" }, value: { kind: "manual-input" }, effectKey: "fill-once" }] });
    let requested = 0;
    const result: string[] = [];
    const adapter = new BrowserRpaAdapter(page, "https://sensitive.test", { verifyGrant: async () => true, resolveInput: async () => { requested++; return "SYNTHETIC_PASSWORD_CANARY"; }, receiveRead: (_, text) => result.push(text) });
    const signal = new AbortController().signal, step = parsed.steps[0];
    await expect(adapter.perform(step, signal)).rejects.toThrow("BLK-RPA-SENSITIVE-001");
    expect(requested).toBe(0); expect(await page.locator("output").textContent()).toBe("0");
    await adapter.perform({ ...step, value: { kind: "manual-input", sensitive: true } }, signal);
    expect(requested).toBe(1); expect(await page.locator("output").textContent()).toBe("1");
    await expect(adapter.perform({ ...step, action: "read", value: undefined }, signal)).rejects.toThrow("BLK-RPA-SENSITIVE-001");
    expect(result).toEqual([]);
  } finally {
    await browser?.close();
    if (oldTemp === undefined) delete process.env.TEMP; else process.env.TEMP = oldTemp;
    if (oldTmp === undefined) delete process.env.TMP; else process.env.TMP = oldTmp;
  }
}, 20000);
