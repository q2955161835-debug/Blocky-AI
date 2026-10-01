import { expect, it, vi } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { digest } from "@blocky/language-schema";
import { codingResultSchema, type CodingStart } from "@blocky/builder-protocol";
import { runCodingAgent } from "../src/coding";
import type { BuilderGeneration } from "../src/transport";

const start: CodingStart = {
  schemaVersion: "blocky.coding-start/v1",
  requestId: "coding-request",
  projectId: "research-workbench",
  moduleId: "research-agent",
  prompt: "修复说明文件并验证",
  originalJson: JSON.stringify(createStarter()),
  resourceId: "coding-model",
  selection: [],
  conversation: [],
};
const generation = (
  content: BuilderGeneration["content"],
): BuilderGeneration => ({
  content,
  provider: "fixture",
  model: "fixture",
  requestId: "response",
  transport: "local",
  usage: null,
});
const call = (id: string, name: string, args: unknown = {}) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});
it("does not begin a deferred Host tool when cancellation lands after tool.started", async () => {
  const controller = new AbortController(),
    executeTool = vi.fn(async () => ({}));
  await expect(
    runCodingAgent(start, {
      modelId: "fixture",
      signal: controller.signal,
      executeTool,
      generate: async () =>
        generation([
          call("read-late", "workspace_read", { path: "README.md" }),
        ]),
      onEvent: (event) => {
        if (event.kind === "tool.started")
          queueMicrotask(() => controller.abort());
      },
    }),
  ).rejects.toThrow("BLK-CODING-CANCELLED");
  expect(executeTool).not.toHaveBeenCalled();
});

it("answers in plain text with Pi metadata and bounded conversation context", async () => {
  const result = await runCodingAgent(
    { ...start, conversation: [{ role: "user", text: "先前的问题" }] },
    {
      modelId: "fixture",
      executeTool: async () => {
        throw Error("must not execute");
      },
      generate: async (input) => {
        expect(JSON.stringify(input.messages)).toContain("先前的问题");
        return generation([{ type: "text", text: "这是完整回答。" }]);
      },
    },
  );
  expect(result.text).toBe("这是完整回答。");
  expect(result.engine).toBe("pi-agent-core/0.86.0");
  expect(result.modelApiCalled).toBe(false);
  expect(result.baseDigest).toBe(await digest(createStarter()));
  expect(result.events.map((e) => e.kind)).toEqual(["text.delta"]);
  expect(codingResultSchema.parse(result)).toEqual(result);
});

it("consumes genuine sequential Host results to read, edit, then verify", async () => {
  const order: string[] = [];
  const change = {
    changeId: "change-1",
    path: "README.md",
    before: "old",
    after: "new",
    beforeDigest: "a".repeat(64),
    afterDigest: "b".repeat(64),
  };
  const result = await runCodingAgent(start, {
    modelId: "fixture",
    generate: async ({ turn, messages }) => {
      if (turn === 1)
        return generation([
          call("read-1", "workspace_read", { path: "README.md" }),
        ]);
      if (turn === 2) {
        expect(
          messages.find((m) => m.tool_call_id === "read-1")?.content,
        ).toContain("old");
        return generation([
          call("write-1", "workspace_write", {
            path: "README.md",
            text: "new",
            expectedDigest: "a".repeat(64),
          }),
          call("verify-1", "blocky_cli", { args: ["compile", "$project"] }),
        ]);
      }
      expect(
        messages.find((m) => m.tool_call_id === "verify-1")?.content,
      ).toContain("exitCode");
      return generation([{ type: "text", text: "已完成验证" }]);
    },
    executeTool: async (name, _args, context) => {
      expect(context?.callId).toBeDefined();
      order.push(name);
      if (name === "workspace_read")
        return { text: "old", digest: "a".repeat(64) };
      if (name === "workspace_write") return { change };
      return { exitCode: 0, output: "passed" };
    },
  });
  expect(order).toEqual(["workspace_read", "workspace_write", "blocky_cli"]);
  expect(result.changes).toEqual([change]);
  expect(result.events.map((e) => e.kind)).toEqual([
    "tool.started",
    "tool.completed",
    "tool.started",
    "tool.completed",
    "file.changed",
    "tool.started",
    "tool.completed",
    "text.delta",
  ]);
});

it("returns safe Host failures to the model for correction", async () => {
  const result = await runCodingAgent(start, {
    modelId: "fixture",
    executeTool: async () => {
      throw Error("BLK-CODING-CONFLICT");
    },
    generate: async ({ turn, messages }) => {
      if (turn === 1)
        return generation([
          call("write-1", "workspace_write", {
            path: "a.txt",
            text: "x",
            expectedDigest: null,
          }),
        ]);
      expect(
        messages.find((m) => m.tool_call_id === "write-1")?.content,
      ).toContain("BLK-CODING-CONFLICT");
      return generation([{ type: "text", text: "文件已变化，需要重新读取。" }]);
    },
  });
  expect(result.events.find((e) => e.kind === "tool.failed")?.code).toBe(
    "BLK-CODING-CONFLICT",
  );
  expect(result.text).toContain("重新读取");
});

it.each(["unknown", "duplicate"])(
  "rejects %s calls before any tool in that response executes",
  async (kind) => {
    let executed = 0;
    await expect(
      runCodingAgent(start, {
        modelId: "fixture",
        executeTool: async () => {
          executed++;
          return {};
        },
        generate: async () =>
          generation(
            kind === "unknown"
              ? [call("one", "workspace_list"), call("two", "shell")]
              : [call("one", "workspace_list"), call("one", "workspace_list")],
          ),
      }),
    ).rejects.toThrow("BLK-CODING-TOOL");
    expect(executed).toBe(0);
  },
);

it("bounds model requests at twelve", async () => {
  let requests = 0;
  await expect(
    runCodingAgent(start, {
      modelId: "fixture",
      executeTool: async () => ({}),
      generate: async ({ turn }) => {
        requests++;
        return generation([call(`call-${turn}`, "workspace_list")]);
      },
    }),
  ).rejects.toThrow("BLK-CODING-BUDGET");
  expect(requests).toBe(12);
});

it("cancels a pending generator even when its callback ignores the signal", async () => {
  const controller = new AbortController();
  const running = runCodingAgent(start, {
    modelId: "fixture",
    signal: controller.signal,
    executeTool: async () => ({}),
    generate: async () => {
      controller.abort();
      return new Promise<BuilderGeneration>(() => {});
    },
  });
  await expect(running).rejects.toThrow("BLK-CODING-CANCELLED");
});

it("enforces the five minute deadline on a pending Host tool", async () => {
  vi.useFakeTimers();
  try {
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => (entered = resolve));
    const running = runCodingAgent(start, {
      modelId: "fixture",
      generate: async () => generation([call("one", "workspace_list")]),
      executeTool: async () => {
        entered();
        return new Promise(() => {});
      },
    });
    const rejected = expect(running).rejects.toThrow("BLK-CODING-BUDGET");
    await ready;
    await vi.advanceTimersByTimeAsync(300000);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});

it("bounds output and rejects malformed Host change/project projections", async () => {
  await expect(
    runCodingAgent(start, {
      modelId: "fixture",
      executeTool: async () => ({}),
      generate: async () =>
        generation([{ type: "text", text: "x".repeat(64001) }]),
    }),
  ).rejects.toThrow("BLK-CODING-BUDGET");
  const result = await runCodingAgent(start, {
    modelId: "fixture",
    generate: async ({ turn }) =>
      generation(
        turn === 1
          ? [call("one", "workspace_list")]
          : [{ type: "text", text: "完成" }],
      ),
    executeTool: async () => ({
      change: { path: "../escaped" },
      project: { invalid: true },
    }),
  });
  expect(result.changes).toEqual([]);
  expect(result.project).toBeUndefined();
});

it("does not split emoji surrogate pairs across streaming frames", async () => {
  const text = "a" + "😀".repeat(8192);
  const result = await runCodingAgent(start, {
    modelId: "fixture",
    generate: async () => generation([{ type: "text", text }]),
    executeTool: async () => ({}),
  });
  const chunks = result.events
    .filter((event) => event.kind === "text.delta")
    .map((event) => event.text!);
  expect(chunks.join("")).toBe(text);
  expect(
    chunks.every(
      (chunk) => chunk.length <= 16384 && !/\p{Surrogate}/u.test(chunk),
    ),
  ).toBe(true);
});
