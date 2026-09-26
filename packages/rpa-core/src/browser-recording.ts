/** Host only. Native recording consent must be granted before start(). */
import { randomUUID } from "node:crypto";
import type { CDPSession, Frame, Page } from "playwright-core";
import { RecordingBuffer, rpaRecordedActionSchema, type RpaRecordedAction, type RpaRecordingResult, type RpaRecordingOptions, type RpaRecordingReason } from "./recording";
import { recordingCollector } from "./browser-recording-collector";

export class BrowserRecording {
  private readonly buffer: RecordingBuffer;
  private readonly binding = `blocky_record_${randomUUID().replaceAll("-", "")}`;
  private readonly removeKey = `${this.binding}_remove`;
  private connection?: CDPSession;
  private contextId?: number;
  private snapshot: (Omit<RpaRecordedAction, "action"> | undefined)[] = [];
  private accepting = true;
  private pending = Promise.resolve();
  private queued = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped?: Promise<RpaRecordingResult>;
  private settled = false;
  private readonly navigation = (frame: Frame) => { if (frame === this.page.mainFrame()) this.end("target-lost"); };
  private readonly closed = () => this.end("target-lost");
  private constructor(private readonly page: Page, private readonly origin: string, options: RpaRecordingOptions) {
    if (options.target.kind !== "browser") throw Error("BLK-RPA-TARGET-001");
    this.buffer = new RecordingBuffer(options);
  }
  static async start(page: Page, origin: string, options: RpaRecordingOptions) {
    const recording = new BrowserRecording(page, origin, options);
    if (!recording.valid()) throw Error("BLK-RPA-TARGET-001");
    try { await recording.install(); return recording; }
    catch {
      await recording.stop("capture-failed").catch(() => {});
      throw Error("BLK-RPA-RECORD-002");
    }
  }
  status() {
    const status = this.buffer.status();
    return { ...status, state: this.settled ? "stopped" as const : this.stopped ? "stopping" as const : "recording" as const };
  }
  private valid() {
    try { return !this.page.isClosed() && new URL(this.page.url()).origin === this.origin; }
    catch { return false; }
  }
  private end(reason: RpaRecordingReason) { void this.stop(reason).catch(() => {}); }
  private receive = (event: { name: string; executionContextId: number; payload: string }) => {
    if (!this.accepting || event.name !== this.binding || event.executionContextId !== this.contextId) return;
    if (!this.valid()) { this.end("target-lost"); return; }
    let input;
    try { if (event.payload.length > 128) throw Error(); input = JSON.parse(event.payload); } catch { this.buffer.append(null); return; }
    const saved = Number.isInteger(input?.index) ? this.snapshot[input.index] : undefined;
    if (!saved || !["click", "fill"].includes(input.action) || this.queued >= 32) { this.buffer.append(null); return; }
    const action = { ...saved, action: input.action }, locator = saved.locator;
    if (locator.kind !== "browser") { this.buffer.append(null); return; }
    this.queued++;
    this.pending = this.pending.then(async () => {
      if (!this.valid()) { this.end("target-lost"); return; }
      const matches = await this.page.getByRole(locator.role, { name: locator.name, exact: true }).count();
      this.buffer.append(matches === 1 ? action : null);
      const status = this.buffer.status();
      if (status.state === "stopped") this.end(status.reason!);
    }).catch(() => { this.buffer.append(null); }).finally(() => { this.queued--; });
  };
  private async install() {
    this.connection = await this.page.context().newCDPSession(this.page);
    const tree = await this.connection.send("Page.getFrameTree");
    const world = await this.connection.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: this.binding, grantUniveralAccess: false });
    this.contextId = world.executionContextId;
    await this.connection.send("Runtime.addBinding", { name: this.binding, executionContextName: this.binding });
    this.connection.on("Runtime.bindingCalled", this.receive);
    this.page.on("framenavigated", this.navigation);
    this.page.on("close", this.closed);
    const result = await this.connection.send("Runtime.evaluate", {
      contextId: this.contextId, expression: `(${recordingCollector})(${JSON.stringify({ binding: this.binding, removeKey: this.removeKey })})`, returnByValue: true, timeout: 1000,
    });
    if (result.exceptionDetails || !Array.isArray(result.result.value) || result.result.value.length > 2048 || this.stopped) throw Error("BLK-RPA-RECORD-002");
    this.snapshot = result.result.value.map((metadata: unknown) => {
      const parsed = rpaRecordedActionSchema.safeParse({ ...(metadata as object), action: "click" });
      return parsed.success ? { locator: parsed.data.locator, sensitive: parsed.data.sensitive } : undefined;
    });
    this.timer = setTimeout(() => this.end("expired"), 600000);
    this.timer.unref();
  }
  stop(reason: RpaRecordingReason): Promise<RpaRecordingResult> {
    if (!this.stopped) {
      this.accepting = false;
      clearTimeout(this.timer);
      this.page.off("framenavigated", this.navigation);
      this.page.off("close", this.closed);
      this.connection?.off("Runtime.bindingCalled", this.receive);
      this.stopped = (async () => {
        let finalReason = reason;
        try {
          if (!this.page.isClosed() && this.connection && this.contextId !== undefined) {
            const removed = await this.connection.send("Runtime.evaluate", { contextId: this.contextId, expression: `globalThis[${JSON.stringify(this.removeKey)}]?.()`, timeout: 1000 });
            if (removed.exceptionDetails) throw Error("BLK-RPA-RECORD-002");
          }
        } catch {
          // Destroy the owned page if removal cannot be proven. Navigation destroys the old world.
          if (!this.page.isClosed() && reason !== "target-lost") {
            await this.page.close({ runBeforeUnload: false });
            finalReason = "capture-failed";
          }
        } finally { await this.connection?.detach().catch(() => {}); }
        await this.pending;
        this.snapshot = [];
        const draft = this.buffer.seal(finalReason);
        this.settled = true;
        return draft;
      })();
    }
    return this.stopped.then(draft => structuredClone(draft));
  }
}
