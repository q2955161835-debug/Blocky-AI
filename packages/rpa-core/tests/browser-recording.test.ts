import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { BrowserRecording } from "../src/browser-recording";

it.skipIf(process.env.BLOCKY_RPA_RECORDING_INTEGRATION !== "1")("captures real browser input metadata in order, excludes values and stops listeners before sealing", async () => {
  const root = resolve("try/stage7/recording-browser-test");
  await mkdir(root, { recursive: true });
  const oldTemp = process.env.TEMP, oldTmp = process.env.TMP;
  process.env.TEMP = root; process.env.TMP = root;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://recording.test/**", route => route.fulfill({ contentType: "text/html", body: '<label>Question<input></label><button>Save</button><input aria-label="Password" role="textbox" type="password"><button>Duplicate</button><button>Duplicate</button><button id="secret" aria-label="token=private-locator">Secret</button><iframe srcdoc="<button>Foreign frame</button>"></iframe>' }));
    await page.goto("https://recording.test/");
    const recorder = await BrowserRecording.start(page, "https://recording.test", {
      sessionId: "recording-browser", projectId: "project-one",
      target: { kind: "browser", identity: "browser:11111111-1111-1111-1111-111111111111" },
    });
    await page.getByRole("textbox", { name: "Question" }).fill("PRIVATE_TYPED_TEXT");
    await page.getByRole("textbox", { name: "Question" }).fill("PRIVATE_TYPED_TEXT_MORE");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "Password" }).fill("PASSWORD_NEVER_CAPTURED");
    await page.getByRole("button", { name: "Duplicate", exact: true }).first().click();
    await page.locator("#secret").click();
    await page.frameLocator("iframe").getByRole("button").click();
    await expect.poll(() => recorder.status().count).toBe(3);
    const draft = await recorder.stop("stopped");
    expect(draft.actions.map(action => [action.action, action.locator.name])).toEqual([["fill", "Question"], ["click", "Save"], ["fill", "Password"]]);
    expect(draft.actions[2].sensitive).toBe(true);
    expect(draft.omitted).toBe(2);
    expect(JSON.stringify(draft)).not.toMatch(/PRIVATE_TYPED|PASSWORD_NEVER|private-locator|Foreign frame/);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(await recorder.stop("target-lost")).toEqual(draft);
    expect(recorder.status().state).toBe("stopped");
    const second = await BrowserRecording.start(page, "https://recording.test", { sessionId: "recording-next", projectId: "project-one", target: draft.target });
    await page.goto("https://recording.test/next");
    await expect.poll(() => second.status().state).toBe("stopped");
    expect((await second.stop("stopped")).reason).toBe("target-lost");
  } finally {
    await browser.close();
    if (oldTemp === undefined) delete process.env.TEMP; else process.env.TEMP = oldTemp;
    if (oldTmp === undefined) delete process.env.TMP; else process.env.TMP = oldTmp;
  }
}, 20000);

it.skipIf(process.env.BLOCKY_RPA_RECORDING_INTEGRATION !== "1")("keeps reflected input out of metadata and isolates cleanup from hostile page code", async () => {
  const root = resolve("try/stage7/recording-browser-test");
  await mkdir(root, { recursive: true });
  const oldTemp = process.env.TEMP, oldTmp = process.env.TMP;
  process.env.TEMP = root; process.env.TMP = root;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://recording.test/**", route => route.fulfill({ contentType: "text/html", body: '<input aria-label="Question"><button>Save</button><script>document.addEventListener("input",e=>e.target.setAttribute("aria-label",e.target.value),true)</script>' }));
    await page.goto("https://recording.test/");
    const recorder = await BrowserRecording.start(page, "https://recording.test", { sessionId: "recording-hostile", projectId: "project-one", target: { kind: "browser", identity: "browser:11111111-1111-1111-1111-111111111111" } });
    await page.locator("input").fill("PRIVATE_REFLECTED_TEXT");
    await expect.poll(() => recorder.status().omitted).toBe(1);
    const keys = await page.evaluate(() => Object.keys(window).filter(key => key.startsWith("blocky_record_")));
    expect(keys).toEqual([]);
    await page.evaluate(() => { (window as any).blocky_record_fake_remove = () => { throw Error("hostile"); }; });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => recorder.status().count).toBe(1);
    const result = await recorder.stop("stopped");
    expect(result.actions[0].locator.name).toBe("Save");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REFLECTED_TEXT");
    expect(recorder.status().state).toBe("stopped");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(await recorder.stop("stopped")).toEqual(result);
  } finally {
    await browser.close();
    if (oldTemp === undefined) delete process.env.TEMP; else process.env.TEMP = oldTemp;
    if (oldTmp === undefined) delete process.env.TMP; else process.env.TMP = oldTmp;
  }
}, 20000);
