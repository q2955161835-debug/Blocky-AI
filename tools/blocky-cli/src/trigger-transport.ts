import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { CliError } from "./protocol";
import { helper } from "./native-store";

const WIRE = "blocky.trigger-session/v1";
const MAX_REQUEST_FRAME = 262_144;
// Receiver polls can return the full bounded queue: 128 payloads of up to
// 32 KiB plus JSON framing. Keep response parsing bounded but large enough.
const MAX_RESPONSE_FRAME = 5 * 1024 * 1024;
const codePattern = /^BLK-(?:[A-Z0-9]+-)*[A-Z0-9]+$/u;
const channelError = (code = "BLK-TRIGGER-CHANNEL") =>
  new CliError(6, codePattern.test(code) && code.startsWith("BLK-TRIGGER-") ? code : "BLK-TRIGGER-CHANNEL", "触发器本机通道失败。", "核对触发器记录后再决定是否重新运行；已预留的 occurrence 不会自动重试。");

type SessionContext = {
  schemaVersion: typeof WIRE;
  requestId: string;
  projectId: string;
  sessionId: string;
};
type Pending = {
  id: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Private stdio session for user-approved durable triggers and receiver polls. */
export class TriggerTransport {
  private child?: ChildProcessWithoutNullStreams;
  private queue = Promise.resolve();
  private pending?: Pending;
  private serial = 0;
  private buffer = "";
  private bytes = 0;
  private fault?: Error;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private exitResolve?: () => void;
  private exit?: Promise<void>;
  private ready?: Promise<void>;
  private closing = false;
  private expectedContext?: SessionContext;

  async open(context: SessionContext, approvedContextDigest: string): Promise<void> {
    if (this.child || !existsSync(helper)) throw channelError();
    const child = spawn(helper, ["--trigger-session"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.expectedContext = context;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.exit = new Promise<void>((resolve) => { this.exitResolve = resolve; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(child, chunk));
    child.stderr.resume();
    child.on("error", () => this.fail(child, channelError()));
    child.stdin.on("error", () => this.fail(child, channelError()));
    child.on("close", (code) => {
      this.exitResolve?.();
      if (!this.closing && this.child === child)
        this.fail(child, channelError(code === 0 ? "BLK-TRIGGER-CHANNEL" : "BLK-TRIGGER-CHANNEL"));
    });
    const initial = JSON.stringify({ ...context, approvedContextDigest }) + "\n";
    if (Buffer.byteLength(initial, "utf8") > MAX_REQUEST_FRAME) {
      this.fail(child, channelError("BLK-TRIGGER-LIMIT"));
      throw channelError("BLK-TRIGGER-LIMIT");
    }
    try {
      await this.write(child, initial);
      await this.ready;
    } catch (error) {
      this.fail(child, error instanceof Error ? error : channelError());
      throw error;
    }
  }

  request(operation: "manage" | "receiver", request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const run = async () => {
      signal?.throwIfAborted();
      const child = this.child;
      if (!child || this.fault || !this.ready) throw this.fault ?? channelError();
      await this.ready;
      const id = ++this.serial;
      if (id > 4096) throw channelError("BLK-TRIGGER-LIMIT");
      const frame = JSON.stringify({ operation, requestId: id, request }) + "\n";
      if (Buffer.byteLength(frame, "utf8") > MAX_REQUEST_FRAME) throw channelError("BLK-TRIGGER-LIMIT");
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => this.fail(child, channelError()), 30_000);
        this.pending = { id, resolve, reject, timer };
        // Once a Host operation is sent, await its authoritative reply even if
        // the Runtime signal aborts. A durable claim may already have landed.
        void this.write(child, frame).catch((error) => this.fail(child, error instanceof Error ? error : channelError()));
      });
    };
    const result = this.queue.then(run);
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await this.queue;
    if (this.fault) {
      child.kill();
      this.child = undefined;
      return;
    }
    const id = ++this.serial;
    const frame = JSON.stringify({ operation: "close", requestId: id }) + "\n";
    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => this.fail(child, channelError()), 3_000);
        this.pending = { id, resolve, reject, timer };
        void this.write(child, frame).catch((error) => this.fail(child, error instanceof Error ? error : channelError()));
      });
      if (!response || typeof response !== "object" || (response as { closed?: unknown }).closed !== true)
        throw channelError();
      this.closing = true;
      child.stdin.end();
      const exit = this.exit;
      if (exit) await Promise.race([exit, new Promise<void>((resolve) => setTimeout(() => { child.kill(); resolve(); }, 3_000))]);
    } finally {
      this.child = undefined;
      this.pending && clearTimeout(this.pending.timer);
      this.pending = undefined;
    }
  }

  private receive(child: ChildProcessWithoutNullStreams, chunk: string) {
    if (this.child !== child) return;
    this.bytes += Buffer.byteLength(chunk, "utf8");
    if (this.bytes > MAX_RESPONSE_FRAME) { this.fail(child, channelError("BLK-TRIGGER-LIMIT")); return; }
    this.buffer += chunk;
    const newline = this.buffer.indexOf("\n");
    if (newline < 0) return;
    if (newline !== this.buffer.length - 1) { this.fail(child, channelError()); return; }
    const line = this.buffer.slice(0, newline);
    this.buffer = "";
    this.bytes = 0;
    let frame: unknown;
    try { frame = JSON.parse(line); } catch { this.fail(child, channelError()); return; }
    if (!frame || typeof frame !== "object") { this.fail(child, channelError()); return; }
    const value = frame as Record<string, unknown>;
    if (value.schemaVersion !== WIRE || !Number.isSafeInteger(value.requestId) || !["ready", "result", "error", "closed"].includes(String(value.type))) {
      this.fail(child, channelError()); return;
    }
    if (value.type === "ready" && value.requestId === 0 && !this.pending) {
      const readyValue = value.value as { projectId?: unknown; sessionId?: unknown } | undefined;
      if (!readyValue || readyValue.projectId !== this.expectedContext?.projectId || readyValue.sessionId !== this.expectedContext?.sessionId) {
        this.fail(child, channelError()); return;
      }
      this.readyResolve?.();
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }
    const pending = this.pending;
    if (!pending || value.requestId !== pending.id || !["result", "error", "closed"].includes(String(value.type))) {
      this.fail(child, channelError()); return;
    }
    this.pending = undefined;
    clearTimeout(pending.timer);
    if (value.type === "error") {
      const code = value.value && typeof value.value === "object" && "code" in value.value
        ? String((value.value as { code: unknown }).code)
        : "BLK-TRIGGER-CHANNEL";
      pending.reject(channelError(code));
    } else pending.resolve(value.value);
  }

  private async write(child: ChildProcessWithoutNullStreams, data: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (this.child !== child || this.fault) { reject(this.fault ?? channelError()); return; }
      child.stdin.write(data, (error) => error ? reject(channelError()) : resolve());
    });
  }

  private fail(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.child !== child) return;
    this.fault ??= error;
    this.readyReject?.(this.fault);
    this.readyReject = undefined;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.fault);
      this.pending = undefined;
    }
    child.kill();
    this.buffer = "";
    this.bytes = 0;
  }
}
