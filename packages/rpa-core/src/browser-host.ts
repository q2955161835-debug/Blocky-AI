/** Host process only. Never import this entry into the Studio WebView. */
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { BrowserRpaAdapter } from "./browser";
import { rpaGrantSchema, rpaPlanSchema, type RpaGrant, type RpaPlan } from "./index";

const stableId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export type BrowserTarget = { identity: string; projectId: string; origin: string };
type Session = { target: BrowserTarget; context: BrowserContext; page: Page; plan?: RpaPlan; grant?: RpaGrant; next: number; failed: boolean; active?: Promise<unknown>; closing?: Promise<void> };

/** Private pipe service owned by the native Host. Native approval must precede authorize(). */
export class BrowserHost {
  private sessions = new Map<string, Session>();
  private closing = false;
  private opening = 0;
  private constructor(private readonly browser: Browser) {}
  static async launch(executablePath: string, artifactsPath: string) {
    const browser = await chromium.launch({
      executablePath, headless: false, chromiumSandbox: true,
      downloadsPath: artifactsPath, tracesDir: artifactsPath,
      args: ["--dns-prefetch-disable", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
    return new BrowserHost(browser);
  }
  async open(projectId: string, inputUrl: string, requestedIdentity?: string): Promise<BrowserTarget> {
    if (!stableId.test(projectId) || projectId.length > 200 || inputUrl.length > 4096) throw Error("BLK-RPA-PLAN-001");
    if (requestedIdentity !== undefined && (!/^browser:[0-9a-f-]{36}$/.test(requestedIdentity) || this.sessions.has(requestedIdentity))) throw Error("BLK-RPA-TARGET-001");
    let url: URL;
    try { url = new URL(inputUrl); } catch { throw Error("BLK-RPA-TARGET-001"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("BLK-RPA-TARGET-001");
    if (this.closing || this.sessions.size + this.opening >= 4) throw Error("BLK-RPA-LIMIT-001");
    this.opening++;
    let context: BrowserContext | undefined;
    try {
      context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: "block", permissions: [], viewport: { width: 1100, height: 760 } });
      const origin = url.origin;
      await context.route("**/*", async (route) => {
        let allowed = false;
        try { allowed = new URL(route.request().url()).origin === origin; } catch { /* deny malformed routes */ }
        if (!allowed) { await route.abort("blockedbyclient").catch(() => {}); return; }
        // Chromium does not re-route redirect hops. Never hand a redirect back to it.
        let response;
        try {
          response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
          if (response.status() >= 300 && response.status() < 400) await route.abort("blockedbyclient");
          else await route.fulfill({ response });
        } catch { await route.abort("blockedbyclient").catch(() => {}); }
        finally { await response?.dispose().catch(() => {}); }
      });
      await context.routeWebSocket("**/*", (socket) => { socket.close(); });
      const page = await context.newPage();
      context.on("page", (other) => { if (other !== page) void other.close().catch(() => {}); });
      page.on("download", (download) => { void download.cancel().catch(() => {}); });
      page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => {}); });
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (new URL(page.url()).origin !== origin || this.closing) throw Error("BLK-RPA-TARGET-001");
      const target = { identity: requestedIdentity ?? `browser:${randomUUID()}`, projectId, origin };
      this.sessions.set(target.identity, { target, context, page, next: 0, failed: false });
      page.on("close", () => { void this.close(target.identity).catch(() => {}); });
      return { ...target };
    } catch {
      await context?.close().catch(() => {});
      throw Error("BLK-RPA-BROWSER-001");
    } finally { this.opening--; }
  }
  inspect(identity: string): BrowserTarget {
    const session = this.session(identity);
    return { ...session.target };
  }
  private session(identity: string) {
    const session = this.sessions.get(identity);
    if (!session || session.closing || this.closing || session.page.isClosed()) throw Error("BLK-RPA-TARGET-001");
    if (new URL(session.page.url()).origin !== session.target.origin) throw Error("BLK-RPA-TARGET-001");
    return session;
  }
  authorize(identity: string, projectId: string, planInput: unknown, grantInput: unknown) {
    const session = this.session(identity);
    const plan = rpaPlanSchema.parse(planInput), grant = rpaGrantSchema.parse(grantInput);
    if (session.active || session.plan && session.next < session.plan.steps.length || session.target.projectId !== projectId
        || plan.target.kind !== "browser" || plan.target.identity !== identity || grant.targetIdentity !== identity || grant.expiresAt <= Date.now()
        || plan.steps.some((step) => step.locator.kind !== "browser" || !grant.actions.includes(step.action) || step.action === "screenshot" || step.value?.kind === "secret-ref"))
      throw Error("BLK-RPA-PERM-001");
    session.plan = structuredClone(plan); session.grant = structuredClone(grant); session.next = 0; session.failed = false;
  }
  async perform(identity: string, token: string, stepId: string, input: string | undefined, signal: AbortSignal): Promise<{ text?: string }> {
    signal.throwIfAborted();
    const session = this.session(identity), step = session.plan?.steps[session.next], grant = session.grant;
    if (!step || !grant || grant.sessionId !== token || grant.expiresAt <= Date.now() || session.failed || session.active || step.stepId !== stepId) throw Error("BLK-RPA-PERM-001");
    if (step.action === "fill" ? input === undefined || Buffer.byteLength(input) > 16384 || input.includes("\0") : input !== undefined) throw Error("BLK-RPA-INPUT-002");
    const result: { text?: string } = {};
    const adapter = new BrowserRpaAdapter(session.page, session.target.origin, {
      verifyGrant: async (candidate, plan) => candidate.sessionId === session.grant?.sessionId && candidate.targetIdentity === identity
        && candidate.expiresAt === session.grant.expiresAt && Date.now() < candidate.expiresAt && plan.target.identity === identity
        && JSON.stringify(candidate.actions) === JSON.stringify(session.grant.actions) && JSON.stringify(plan) === JSON.stringify(session.plan),
      resolveInput: async () => input!, receiveRead: (_stepId, text) => { result.text = text; },
    }, identity);
    const deadline = AbortSignal.timeout(Math.min(step.timeoutMs, Math.max(1, grant.expiresAt - Date.now())));
    const operationSignal = AbortSignal.any([signal, deadline]);
    const abort = () => { void this.close(identity).catch(() => {}); };
    operationSignal.addEventListener("abort", abort, { once: true });
    const active = adapter.perform(step, operationSignal);
    session.active = active;
    try {
      await active;
      operationSignal.throwIfAborted();
      session.next++;
      return result;
    } catch (error) {
      session.failed = true;
      if (operationSignal.aborted) {
        try { await this.close(identity); } catch { throw Error("BLK-RPA-SETTLEMENT-001"); }
        throw Error(signal.aborted ? "BLK-RPA-CANCELLED" : "BLK-RPA-TIMEOUT-001");
      }
      const code = error instanceof Error && /^BLK-RPA-[A-Z0-9-]+$/.test(error.message) ? error.message : "BLK-RPA-BROWSER-001";
      throw Error(code);
    } finally {
      operationSignal.removeEventListener("abort", abort);
      session.active = undefined;
    }
  }
  async close(identity: string) {
    const session = this.sessions.get(identity);
    if (!session) return;
    session.closing ??= (async () => {
      await session.context.close({ reason: "Blocky session closed" });
      await session.active?.catch(() => {});
      this.sessions.delete(identity);
    })();
    await session.closing;
  }
  async shutdown() {
    this.closing = true;
    const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)));
    await this.browser.close();
    if (results.some((result) => result.status === "rejected")) throw Error("BLK-RPA-SETTLEMENT-001");
  }
}
