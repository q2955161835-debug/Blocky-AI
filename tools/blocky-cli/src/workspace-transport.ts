import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { CliError } from "./protocol";

/** Private stdio ownership keeps native file versions and undo receipts alive for one CLI run. */
export class WorkspaceTransport {
  private child?: ChildProcessWithoutNullStreams;
  private queue = Promise.resolve();
  private pending?: { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  private buffer = "";
  private bound?: string;
  private closing = false;
  private closePromise?: Promise<void>;
  constructor(
    private executable: string,
    private args: readonly string[] = ["--blocky-workspace-session"],
  ) {}
  private fail(error: Error) {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.child?.kill(); this.child = undefined; this.bound = undefined; this.buffer = "";
  }
  private start() {
    const child = spawn(this.executable, [...this.args], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child; child.stdout.setEncoding("utf8"); child.stderr.resume();
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.fail(new CliError(6, "BLK-CODING-BUDGET", "工作目录响应超限。"));
      const end = this.buffer.indexOf("\n");
      if (end < 0) return;
      if (!this.pending || end !== this.buffer.length - 1) return this.fail(new CliError(6, "BLK-CODING-STATE", "工作目录通道无效。"));
      const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer);
      try {
        const reply = JSON.parse(this.buffer); this.buffer = "";
        if (reply.schemaVersion !== "blocky.project-io/v1alpha1" || typeof reply.ok !== "boolean") throw Error();
        if (!reply.ok) pending.reject(new CliError(3, /^BLK-[A-Z0-9-]+$/.test(reply.code) ? reply.code : "BLK-CODING-STATE", "工作目录操作未完成。"));
        else pending.resolve(reply.value);
      } catch { pending.reject(new CliError(6, "BLK-CODING-STATE", "工作目录响应无效。")); this.fail(new CliError(6, "BLK-CODING-STATE", "工作目录通道已关闭。")); }
    });
    child.on("error", () => { if (this.child === child) this.fail(new CliError(6, "BLK-HOST-001", "无法启动工作目录工具。")); });
    child.on("close", () => { if (this.child === child) this.fail(new CliError(6, "BLK-CODING-STATE", "工作目录工具已退出。")); });
    child.stdin.on("error", () => { if (this.child === child) this.fail(new CliError(6, "BLK-CODING-STATE", "工作目录通道已关闭。")); });
  }
  private send(fields: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const run = async () => {
      signal?.throwIfAborted();
      if (this.closing) throw new CliError(6, "BLK-CODING-STATE", "工作目录通道已关闭。");
      if (!this.child) this.start();
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => this.fail(new CliError(6, "BLK-CODING-TIMEOUT", "工作目录工具超时。")), 30000);
        const requestId = (fields.request as { requestId?: string } | undefined)?.requestId;
        const cancel = () => { if (requestId) this.cancel(requestId); };
        signal?.addEventListener("abort", cancel, { once: true });
        const cleanup = () => signal?.removeEventListener("abort", cancel);
        this.pending = { resolve(value) { cleanup(); resolve(value); }, reject(error) { cleanup(); reject(error); }, timer };
        this.child!.stdin.write(JSON.stringify({ schemaVersion: "blocky.project-io/v1alpha1", ...fields }) + "\n");
        if (signal?.aborted) cancel();
      });
    };
    const pending = this.queue.then(run); this.queue = pending.then(() => {}, () => {}); return pending;
  }
  async bind(projectId: string, path: string, signal?: AbortSignal) {
    const binding = JSON.stringify([projectId, resolve(path)]);
    if (this.bound === binding) return;
    await this.send({ operation: "workspace-bind", projectId, path: resolve(path) }, signal); this.bound = binding;
  }
  call(request: unknown, signal?: AbortSignal) { return this.send({ operation: "workspace-call", request }, signal); }
  status(projectId: string) { return this.send({ operation: "workspace-status", projectId }); }
  cancel(requestId: string) { this.child?.stdin.write(JSON.stringify({ schemaVersion: "blocky.project-io/v1alpha1", operation: "workspace-cancel", requestId }) + "\n"); }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const child = this.child;
    if (!child) return;
    const error = new CliError(6, "BLK-CODING-STATE", "工作目录通道已关闭。");
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    this.closePromise = new Promise<void>((done) => {
      const timer = setTimeout(() => child.kill(), 5000);
      child.once("close", () => { clearTimeout(timer); done(); });
      child.stdin.end();
    }).finally(() => {
      if (this.child === child) {
        this.child = undefined;
        this.bound = undefined;
      }
    });
    return this.closePromise;
  }
}
