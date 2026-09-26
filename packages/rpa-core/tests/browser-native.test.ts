import { expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BrowserHost } from "../src/browser-host";

it.skipIf(process.env.BLOCKY_RPA_BROWSER_INTEGRATION !== "1")("isolates real browser contexts, performs approved semantic steps and settles cancellation", async () => {
  const root = resolve("try/stage7/browser-tests");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(resolve(root, "session-"));
  if (dirname(temp) !== root) throw Error("test artifact path escaped root");
  const oldTemp = process.env.TEMP, oldTmp = process.env.TMP;
  process.env.TEMP = temp; process.env.TMP = temp;
  let effects = 0, passwordInputs = 0, escapedRequests = 0, redirects = 0;
  const outside = createServer((_request, response) => { escapedRequests++; response.end("outside"); });
  await new Promise<void>((done) => outside.listen(0, "127.0.0.1", done));
  const outsideAddress = outside.address();
  if (!outsideAddress || typeof outsideAddress === "string") throw Error("outside fixture address");
  const outsideUrl = `http://127.0.0.1:${outsideAddress.port}/escaped`;
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/redirect/")) {
      redirects++; response.writeHead(Number(request.url.split("/")[2]), { Location: outsideUrl }); response.end(); return;
    }
    if (request.url === "/effect") { effects++; response.end(String(effects)); return; }
    if (request.url === "/password-touched") { passwordInputs++; response.end("ok"); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><title>Blocky owned browser fixture</title>
      <h1 aria-label="Session"></h1><label>Input<input aria-label="Input"></label>
      <button>Save</button><button id="redirect">Redirect probes</button><div role="status" aria-label="Redirects" hidden></div><div role="status" aria-label="Saved" hidden></div>
      <input type="password" role="textbox" aria-label="Password" oninput="fetch('/password-touched')">
      <script>if(location.search)document.cookie='fixture=first; SameSite=Strict';document.querySelector('h1').textContent=document.cookie||'empty';
      document.querySelector('button').onclick=async()=>{const text=await(await fetch('/effect')).text();const out=document.querySelector('[aria-label=Saved]');out.textContent=text;out.hidden=false;};
      document.querySelector('#redirect').onclick=async()=>{await Promise.allSettled([302,307,308].map(code=>fetch('/redirect/'+code,{method:'POST',body:'private-owned-fixture'})));const out=document.querySelector('[aria-label=Redirects]');out.textContent='done';out.hidden=false;};</script>`);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  let host: BrowserHost | undefined;
  const grant = (identity: string, sessionId: string) => ({ schemaVersion: "blocky.rpa-grant/v1", sessionId, targetIdentity: identity, expiresAt: Date.now() + 60000, actions: ["find", "read", "fill", "click", "wait"] });
  const plan = (identity: string, steps: unknown[]) => ({ schemaVersion: "blocky.rpa/v1", planId: "owned-browser-plan", target: { kind: "browser", identity }, steps });
  const read = (stepId: string, role: string, name: string) => ({ stepId, action: "read", locator: { kind: "browser", role, name } });
  try {
    host = await BrowserHost.launch(process.env.BLOCKY_RPA_BROWSER_EXE ?? resolve("try/stage7/browser-assets/playwright-browsers/chromium-1243/chrome-win64/chrome.exe"), temp);
    const first = await host.open("project-one", `${origin}/?first`), second = await host.open("project-two", origin);
    expect(first.identity).not.toBe(second.identity);
    const firstPlan = plan(first.identity, [
      read("cookie", "heading", "Session"), { stepId: "fill", action: "fill", locator: { kind: "browser", role: "textbox", name: "Input" }, value: { kind: "manual-input" }, effectKey: "fill-once" },
      read("value", "textbox", "Input"), { stepId: "click", action: "click", locator: { kind: "browser", role: "button", name: "Save" }, effectKey: "click-once" }, read("result", "status", "Saved"),
    ]);
    expect(() => host!.authorize(first.identity, "project-two", firstPlan, grant(first.identity, "grant-first"))).toThrow("BLK-RPA-PERM-001");
    host.authorize(first.identity, "project-one", firstPlan, grant(first.identity, "grant-first"));
    host.authorize(second.identity, "project-two", plan(second.identity, [read("cookie", "heading", "Session")]), grant(second.identity, "grant-second"));
    const signal = new AbortController().signal;
    await expect(host.perform(first.identity, "forged", "cookie", undefined, signal)).rejects.toThrow("BLK-RPA-PERM-001");
    expect((await host.perform(first.identity, "grant-first", "cookie", undefined, signal)).text).toBe("fixture=first");
    expect((await host.perform(second.identity, "grant-second", "cookie", undefined, signal)).text).toBe("empty");
    await host.perform(first.identity, "grant-first", "fill", "private-fixture-input", signal);
    expect((await host.perform(first.identity, "grant-first", "value", undefined, signal)).text).toBe("private-fixture-input");
    await host.perform(first.identity, "grant-first", "click", undefined, signal);
    expect((await host.perform(first.identity, "grant-first", "result", undefined, signal)).text).toBe("1");
    expect(effects).toBe(1);
    await expect(host.perform(first.identity, "grant-first", "click", undefined, signal)).rejects.toThrow("BLK-RPA-PERM-001");
    host.authorize(second.identity, "project-two", plan(second.identity, [{ stepId: "secret", action: "fill", locator: { kind: "browser", role: "textbox", name: "Password" }, value: { kind: "manual-input" }, effectKey: "secret-once" }]), grant(second.identity, "grant-secret"));
    await expect(host.perform(second.identity, "grant-secret", "secret", "never-typed", signal)).rejects.toThrow("BLK-RPA-SENSITIVE-001");
    expect(passwordInputs).toBe(0);
    host.authorize(first.identity, "project-one", plan(first.identity, [
      { stepId: "redirect", action: "click", locator: { kind: "browser", role: "button", name: "Redirect probes" }, effectKey: "redirect-once" },
      read("redirect-result", "status", "Redirects"),
    ]), grant(first.identity, "grant-redirect"));
    await host.perform(first.identity, "grant-redirect", "redirect", undefined, signal);
    expect((await host.perform(first.identity, "grant-redirect", "redirect-result", undefined, signal)).text).toBe("done");
    expect(redirects).toBe(3);
    expect(escapedRequests).toBe(0);
    host.authorize(first.identity, "project-one", plan(first.identity, [{ stepId: "waiting", action: "wait", locator: { kind: "browser", role: "button", name: "Absent" }, timeoutMs: 10000 }]), grant(first.identity, "grant-wait"));
    const cancel = new AbortController();
    const pending = host.perform(first.identity, "grant-wait", "waiting", undefined, cancel.signal);
    cancel.abort();
    await expect(pending).rejects.toThrow("BLK-RPA-CANCELLED");
    expect(() => host!.inspect(first.identity)).toThrow("BLK-RPA-TARGET-001");
    await host.close(second.identity);
    expect(() => host!.inspect(second.identity)).toThrow("BLK-RPA-TARGET-001");
    await expect(host.open("project-one", "file:///C:/private.txt")).rejects.toThrow("BLK-RPA-TARGET-001");
  } finally {
    await host?.shutdown();
    await new Promise<void>((done) => server.close(() => done()));
    await new Promise<void>((done) => outside.close(() => done()));
    if (oldTemp === undefined) delete process.env.TEMP; else process.env.TEMP = oldTemp;
    if (oldTmp === undefined) delete process.env.TMP; else process.env.TMP = oldTmp;
    await rm(temp, { recursive: true, force: true });
  }
}, 60000);
