import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { createCodingWorker } from "../src/coding-worker";
import type { BuilderGeneration } from "../src/transport";
import { spawn } from "node:child_process";

const request = {
  schemaVersion: "blocky.coding-start/v1",
  requestId: "worker-request",
  projectId: "research-workbench",
  moduleId: "research-agent",
  prompt: "读取文件",
  originalJson: JSON.stringify(createStarter()),
  resourceId: "test-model",
  selection: [],
  conversation: [],
};
const gen = (content: BuilderGeneration["content"]): BuilderGeneration => ({
  content,
  provider: "fixture",
  model: "fixture",
  requestId: "response",
  transport: "local",
  usage: null,
});
const frame = (extra: Record<string, unknown>): Record<string, unknown> => ({
  schemaVersion: "blocky.coding-ipc/v1",
  requestId: request.requestId,
  ...extra,
});
function harness() {
  const frames: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  let closed = false;
  const worker = createCodingWorker({
    send: (f) => {
      frames.push(f);
      waiters.splice(0).forEach((w) => w());
    },
    close: () => {
      closed = true;
      waiters.splice(0).forEach((w) => w());
    },
  });
  async function next(kind: string) {
    while (!frames.some((f) => f.kind === kind)) {
      if (closed) throw Error("worker closed");
      await new Promise<void>((r) => waiters.push(r));
    }
    return frames.find((f) => f.kind === kind)!;
  }
  return {
    frames,
    worker,
    next,
    get closed() {
      return closed;
    },
  };
}

it("binds every coding frame to requestId and tool results to the outstanding callId", async () => {
  const h = harness();
  const run = h.worker.receive(
    frame({ kind: "start", start: request, modelId: "fixture" }),
  );
  const provider = await h.next("provider.call");
  expect(provider.turn).toBe(1);
  await h.worker.receive(
    frame({
      kind: "provider.result",
      turn: 1,
      value: gen([
        {
          type: "toolCall",
          id: "read-one",
          name: "workspace_read",
          arguments: { path: "README.md" },
        },
      ]),
    }),
  );
  const tool = await h.next("tool.call");
  expect(tool).toMatchObject({
    callId: "read-one",
    name: "workspace_read",
    args: { path: "README.md" },
  });
  await h.worker.receive(
    frame({
      kind: "tool.result",
      callId: "read-one",
      ok: true,
      result: { text: "actual host text" },
    }),
  );
  while (!h.frames.some((f) => f.kind === "provider.call" && f.turn === 2))
    await new Promise((r) => setTimeout(r, 0));
  const second = h.frames.find(
    (f) => f.kind === "provider.call" && f.turn === 2,
  )!;
  expect(JSON.stringify(second.messages)).toContain("actual host text");
  await h.worker.receive(
    frame({
      kind: "provider.result",
      turn: 2,
      value: gen([{ type: "text", text: "读取完成" }]),
    }),
  );
  await run;
  expect(h.frames.find((f) => f.kind === "complete")?.result).toMatchObject({
    text: "读取完成",
  });
  expect(
    h.frames.every(
      (f) =>
        f.schemaVersion === "blocky.coding-ipc/v1" &&
        f.requestId === request.requestId,
    ),
  ).toBe(true);
  expect(h.closed).toBe(true);
});

it.each(["wrong request", "wrong turn", "extra field", "wrong schema"])(
  "rejects %s provider replies",
  async (kind) => {
    const h = harness();
    const run = h.worker.receive(
      frame({ kind: "start", start: request, modelId: "fixture" }),
    );
    await h.next("provider.call");
    const reply = frame({
      kind: "provider.result",
      turn: 1,
      value: gen([{ type: "text", text: "reply" }]),
    });
    if (kind === "wrong request") reply.requestId = "another-request";
    if (kind === "wrong turn") reply.turn = 2;
    if (kind === "extra field") reply.secret = "canary";
    if (kind === "wrong schema") reply.schemaVersion = "blocky.builder-ipc/v1";
    await expect(h.worker.receive(reply)).rejects.toThrow("BLK-CODING-WIRE");
    h.worker.end();
    await run;
    expect(h.frames.some((f) => f.kind === "complete")).toBe(false);
  },
);

it("refuses late tool IDs and settles pending requests on cancel", async () => {
  const h = harness();
  const run = h.worker.receive(
    frame({ kind: "start", start: request, modelId: "fixture" }),
  );
  await h.next("provider.call");
  await h.worker.receive(
    frame({
      kind: "provider.result",
      turn: 1,
      value: gen([
        { type: "toolCall", id: "one", name: "workspace_list", arguments: {} },
      ]),
    }),
  );
  await h.next("tool.call");
  await expect(
    h.worker.receive(
      frame({ kind: "tool.result", callId: "late", ok: true, result: {} }),
    ),
  ).rejects.toThrow("BLK-CODING-WIRE");
  await h.worker.receive(frame({ kind: "cancel" }));
  await run;
  expect(h.frames.some((f) => f.kind === "complete")).toBe(false);
  expect(h.closed).toBe(true);
});

it.each(["coding", "builder"])(
  "routes the first stdin schema to %s without competing listeners",
  async (kind) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "packages/builder-engine/src/worker.ts"],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
    );
    const received: Record<string, unknown>[] = [];
    let buffer = "",
      stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.setEncoding("utf8");
    const finished = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(Error(`worker exited ${code}: ${stderr}`)),
      );
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const output = JSON.parse(buffer.slice(0, at));
          buffer = buffer.slice(at + 1);
          received.push(output);
          if (output.kind === "provider.call")
            child.stdin.write(
              JSON.stringify(
                frame({
                  kind: "provider.result",
                  turn: output.turn,
                  value: gen([{ type: "text", text: "actual worker reply" }]),
                }),
              ) + "\n",
            );
        }
      });
    });
    try {
      if (kind === "coding")
        child.stdin.write(
          JSON.stringify(
            frame({ kind: "start", start: request, modelId: "fixture" }),
          ) + "\n",
        );
      else
        child.stdin.write(
          JSON.stringify({
            schemaVersion: "blocky.builder-ipc/v1",
            kind: "start",
            requestId: "legacy-request",
            request: {
              schemaVersion: "blocky.builder-request/v1",
              requestId: "legacy-request",
              projectId: request.projectId,
              moduleId: request.moduleId,
              prompt: "调整为学习助手",
              intent: "build",
              selection: [],
              createSurface: false,
            },
            project: createStarter(),
            registry: [],
            mode: "deterministic",
            modelId: "fixture",
          }) + "\n",
        );
      await finished;
      expect(received.some((output) => output.kind === "error")).toBe(false);
      expect(
        received.find((output) => output.kind === "complete")?.result,
      ).toMatchObject(
        kind === "coding"
          ? { text: "actual worker reply" }
          : { engine: "pi-agent-core/0.86.0" },
      );
      expect(
        received.every(
          (output) =>
            output.schemaVersion ===
            `blocky.${kind === "coding" ? "coding" : "builder"}-ipc/v1`,
        ),
      ).toBe(true);
    } finally {
      child.kill();
    }
  },
);

it("carries a long model response through coding IPC without truncating events or final text", async () => {
  const h = harness(),
    long = "中😀".repeat(50_000);
  const run = h.worker.receive(
    frame({ kind: "start", start: request, modelId: "fixture" }),
  );
  await h.next("provider.call");
  await h.worker.receive(
    frame({
      kind: "provider.result",
      turn: 1,
      value: gen([{ type: "text", text: long }]),
    }),
  );
  await run;
  expect(h.frames.find((f) => f.kind === "complete")?.result).toMatchObject({
    text: long,
  });
  expect(
    h.frames
      .filter((f) => f.kind === "event")
      .map((f) => (f.event as { text?: string }).text ?? "")
      .join(""),
  ).toBe(long);
});
