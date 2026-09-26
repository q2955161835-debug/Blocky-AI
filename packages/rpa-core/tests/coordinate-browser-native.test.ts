import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { BrowserHost } from "../src/browser-host";

it.skipIf(process.env.BLOCKY_RPA_COORDINATE_HEADLESS !== "1")("clicks a real isolated page once with coordinate permission and rejects out-of-viewport clicks", async () => {
  const root = resolve("try/stage7/coordinate-browser-tests"); await mkdir(root, { recursive: true });
  const temporary = await mkdtemp(resolve(root, "session-")), oldTemp = process.env.TEMP, oldTmp = process.env.TMP;
  process.env.TEMP = temporary; process.env.TMP = temporary;
  let browser, host: BrowserHost | undefined;
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end('<style>body{margin:0}canvas{display:block;width:100px;height:100px;background:green}</style><canvas width="100" height="100" onclick="document.querySelector(\'[role=status]\').textContent=Number(document.querySelector(\'[role=status]\').textContent)+1"></canvas><div role="status" aria-label="Count">0</div>'); });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    // Use the same production Host with an owned headless browser, without adding a product test mode.
    host = Reflect.construct(BrowserHost, [browser]) as BrowserHost;
    const port = (server.address() as { port: number }).port;
    const target = await host.open("coordinate-project", `http://127.0.0.1:${port}/`);
    const steps = [
      { stepId: "click", action: "click", locator: { kind: "coordinate", x: 50, y: 50, riskAccepted: true }, effectKey: "once" },
      { stepId: "count", action: "read", locator: { kind: "browser", role: "status", name: "Count" } },
    ];
    const plan = { schemaVersion: "blocky.rpa/v1", planId: "coordinate", target: { kind: "browser", identity: target.identity }, steps };
    const grant = { schemaVersion: "blocky.rpa-grant/v1", sessionId: "coordinate-grant", targetIdentity: target.identity, actions: ["click", "read"], expiresAt: Date.now() + 60000, coordinateFallback: true };
    expect(() => host!.authorize(target.identity, target.projectId, plan, { ...grant, coordinateFallback: false })).toThrow("BLK-RPA-PERM-001");
    host.authorize(target.identity, target.projectId, plan, grant);
    const signal = new AbortController().signal;
    await host.perform(target.identity, grant.sessionId, "click", undefined, signal);
    expect((await host.perform(target.identity, grant.sessionId, "count", undefined, signal)).text).toBe("1");
    await expect(host.perform(target.identity, grant.sessionId, "click", undefined, signal)).rejects.toThrow("BLK-RPA-PERM-001");
    host.authorize(target.identity, target.projectId, { ...plan, steps: [{ ...steps[0], locator: { kind: "coordinate", x: 1100, y: 50, riskAccepted: true } }] }, grant);
    await expect(host.perform(target.identity, grant.sessionId, "click", undefined, signal)).rejects.toThrow("BLK-RPA-COORDINATE-001");
    const page = browser.contexts()[0].pages()[0];
    expect(await page.getByRole("status", { name: "Count" }).innerText()).toBe("1");
    const second = await host.open("coordinate-project", `http://127.0.0.1:${port}/`);
    host.authorize(second.identity, second.projectId, { ...plan, target: { ...plan.target, identity: second.identity } }, { ...grant, targetIdentity: second.identity });
    const resized = browser.contexts()[1].pages()[0];
    await resized.setViewportSize({ width: 1000, height: 760 });
    await expect(host.perform(second.identity, grant.sessionId, "click", undefined, signal)).rejects.toThrow("BLK-RPA-COORDINATE-001");
    expect(await resized.getByRole("status", { name: "Count" }).innerText()).toBe("0");
  } finally {
    if (host) await host.shutdown(); else await browser?.close();
    await new Promise<void>(done => server.close(() => done()));
    if (oldTemp === undefined) delete process.env.TEMP; else process.env.TEMP = oldTemp;
    if (oldTmp === undefined) delete process.env.TMP; else process.env.TMP = oldTmp;
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
