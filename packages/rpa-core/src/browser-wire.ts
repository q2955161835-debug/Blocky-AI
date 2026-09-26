/** Native Host private pipe protocol; this is not a WebView or network API. */
import { z } from "zod";
import { BrowserHost } from "./browser-host";
import { rpaGrantSchema, rpaPlanSchema } from "./index";

const base = { schemaVersion: z.literal("blocky.browser-ipc/v1"), requestId: z.number().int().min(1).max(1000000) };
const identity = z.string().regex(/^browser:[0-9a-f-]{36}$/);
const stableId = z.string().max(200).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const frameSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("init"), executablePath: z.string().min(1).max(4096), artifactsPath: z.string().min(1).max(4096) }).strict(),
  z.object({ ...base, kind: z.literal("open"), projectId: stableId, url: z.string().min(1).max(4096), identity: identity.optional() }).strict(),
  z.object({ ...base, kind: z.literal("inspect"), identity }).strict(),
  z.object({ ...base, kind: z.literal("authorize"), identity, projectId: stableId, plan: rpaPlanSchema, grant: rpaGrantSchema }).strict(),
  z.object({ ...base, kind: z.literal("perform"), identity, token: stableId, stepId: stableId, input: z.string().max(16384).optional() }).strict(),
  z.object({ ...base, kind: z.literal("capture-read"), identity, token: stableId, captureId: z.string().regex(/^capture-[0-9a-f-]{36}$/), stepId: stableId, offset: z.number().int().min(0).max(4194303) }).strict(),
  z.object({ ...base, kind: z.literal("record-start"), identity, projectId: stableId, sessionId: stableId }).strict(),
  z.object({ ...base, kind: z.literal("record-status"), identity, sessionId: stableId }).strict(),
  z.object({ ...base, kind: z.literal("record-stop"), identity, sessionId: stableId }).strict(),
  z.object({ ...base, kind: z.literal("close"), identity }).strict(),
  z.object({ ...base, kind: z.literal("shutdown") }).strict(),
]);
export class BrowserPipe {
  private host?: BrowserHost;
  private sequence = 0;
  private active = false;
  private closed = false;
  async receive(bytes: Uint8Array) {
    if (this.closed || this.active || bytes.byteLength > 65536) throw Error("BLK-RPA-WIRE-001");
    this.active = true;
    let requestId = 0;
    try {
      const frame = frameSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (frame.requestId !== this.sequence + 1) throw Error("BLK-RPA-WIRE-001");
      requestId = frame.requestId; this.sequence = requestId;
      let value: unknown;
      if (frame.kind === "init") {
        if (this.host || requestId !== 1) throw Error("BLK-RPA-WIRE-001");
        this.host = await BrowserHost.launch(frame.executablePath, frame.artifactsPath);
        value = { ready: true };
      } else {
        if (!this.host) throw Error("BLK-RPA-WIRE-001");
        switch (frame.kind) {
          case "open": value = await this.host.open(frame.projectId, frame.url, frame.identity); break;
          case "inspect": value = this.host.inspect(frame.identity); break;
          case "authorize": this.host.authorize(frame.identity, frame.projectId, frame.plan, frame.grant); value = { authorized: true }; break;
          case "perform": value = await this.host.perform(frame.identity, frame.token, frame.stepId, frame.input, new AbortController().signal); break;
          case "capture-read": value = this.host.readCapture(frame.identity, frame.token, frame.captureId, frame.stepId, frame.offset); break;
          case "record-start": value = await this.host.startRecording(frame.identity, frame.projectId, frame.sessionId); break;
          case "record-status": value = this.host.recordingStatus(frame.identity, frame.sessionId); break;
          case "record-stop": value = await this.host.stopRecording(frame.identity, frame.sessionId); break;
          case "close": await this.host.close(frame.identity); value = { closed: true }; break;
          case "shutdown": await this.shutdown(); value = { settled: true }; break;
        }
      }
      return { schemaVersion: "blocky.browser-ipc/v1", requestId, ok: true, value };
    } catch (error) {
      const code = error instanceof Error && /^BLK-RPA-[A-Z0-9-]+$/.test(error.message) ? error.message : "BLK-RPA-WIRE-001";
      return { schemaVersion: "blocky.browser-ipc/v1", requestId, ok: false, code };
    } finally { this.active = false; }
  }
  async shutdown() {
    this.closed = true;
    await this.host?.shutdown();
  }
}
