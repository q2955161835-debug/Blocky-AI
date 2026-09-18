import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CliError } from "./protocol";
const MAX_FRAME = 384 * 1024 * 1024;
/** A private stdio session keeps the verified model warm for a CLI batch. No socket. */
export class KnowledgeTransport {
  private child?: ChildProcessWithoutNullStreams;
  private queue = Promise.resolve();
  private waiting?: {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private output = "";
  private bytes = 0;
  constructor(private executable: string) {}
  request(input: Record<string, unknown>): Promise<unknown> {
    const operation = async () => {
      if (!this.child) this.start();
      const payload =
        JSON.stringify({
          schemaVersion: "blocky.project-io/v1alpha1",
          ...input,
        }) + "\n";
      if (Buffer.byteLength(payload) > MAX_FRAME)
        throw new CliError(3, "BLK-KNOW-LIMIT", "知识请求超出存储上限。");
      return new Promise((resolve, reject) => {
        const timeout =
          input.operation === "knowledge-embed-index"
            ? 2 * 60 * 60 * 1000
            : 120000;
        const timer = setTimeout(
          () => this.fail(new CliError(6, "BLK-HOST-002", "知识任务超时。")),
          timeout,
        );
        this.waiting = { resolve, reject, timer };
        this.child!.stdin.write(payload);
      });
    };
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private start() {
    const child = spawn(this.executable, ["--blocky-knowledge-session"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.output = "";
    this.bytes = 0;
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdout.on("data", (data: string) => {
      if (this.child !== child) return;
      this.bytes += Buffer.byteLength(data);
      if (this.bytes > MAX_FRAME) {
        this.fail(new CliError(6, "BLK-KNOW-LIMIT", "知识响应超出存储上限。"));
        return;
      }
      this.output += data;
      const end = this.output.indexOf("\n");
      if (end < 0) return;
      const pending = this.waiting;
      if (!pending) {
        this.fail(new CliError(6, "BLK-HOST-001", "意外的知识响应。"));
        return;
      }
      this.waiting = undefined;
      clearTimeout(pending.timer);
      const line = this.output.slice(0, end);
      this.output = this.output.slice(end + 1);
      this.bytes = Buffer.byteLength(this.output);
      try {
        pending.resolve(JSON.parse(line));
      } catch {
        pending.reject(new CliError(6, "BLK-HOST-001", "知识响应无效。"));
      }
    });
    child.on("error", () => {
      if (this.child === child)
        this.fail(new CliError(6, "BLK-HOST-001", "无法启动知识服务。"));
    });
    child.stdin.on("error", () => {
      if (this.child === child)
        this.fail(new CliError(6, "BLK-HOST-001", "知识任务通道已关闭。"));
    });
    child.on("close", () => {
      if (this.child === child)
        this.fail(new CliError(6, "BLK-HOST-001", "知识服务已退出。"));
    });
  }
  private fail(error: Error) {
    const pending = this.waiting;
    this.waiting = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.child?.kill();
    this.child = undefined;
    this.output = "";
    this.bytes = 0;
  }
  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    if (this.waiting) {
      clearTimeout(this.waiting.timer);
      this.waiting.reject(new CliError(7, "BLK-RUN-005", "知识任务已停止。"));
      this.waiting = undefined;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
      }, 3000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
}
