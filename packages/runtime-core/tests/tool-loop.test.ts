import { expect, it } from "vitest";
import { runToolLoop, type ToolLoopContext } from "../src/tool-loop";
import { RunBudget } from "../src/budget";
import { createAgentExample } from "../../block-catalog/src/index";
import type { Generation, GenerationRequest } from "../src/agent-context";
import type { Json } from "@blocky/language-schema";

const response = (
  text: string,
  toolCalls: Generation["toolCalls"] = [],
): Generation => ({
  schemaVersion: "blocky.model-response/v2",
  provider: "unit-fixture",
  transport: "local",
  model: "unit-fixture",
  requestId: "unit-response",
  usage: null,
  usageStatus: "unavailable",
  finishReason: toolCalls.length ? "tool_calls" : "stop",
  text,
  toolCalls,
});
function setup(
  generate: ToolLoopContext["generate"],
  invoke: ToolLoopContext["invoke"],
) {
  const project = createAgentExample("tool-loop-test"),
    budget = new RunBudget();
  const context: ToolLoopContext = {
    project,
    budget,
    model: project.resources["agent-model"],
    requestId: "run-loop",
    role: "Use the available tools to answer the request.",
    instruction: "",
    question: "Count the words.",
    memory: null,
    value: null,
    citations: [],
    requireEvidence: false,
    resourceIds: ["text-tool"],
    maxTurns: 4,
    outputPerTurn: 512,
    generate,
    invoke,
    onGeneration: () => {},
    onEvent: () => {},
  };
  return { context, budget };
}
it("returns real dependent tool outputs to the same conversation before model completion", async () => {
  const prompts: GenerationRequest[] = [],
    called: Json[] = [];
  const { context, budget } = setup(
    async (request) => {
      prompts.push(structuredClone(request));
      if (prompts.length === 1)
        return response("", [
          {
            id: "call-one",
            name: "tool_1",
            arguments: { input: "Hello world" },
          },
        ]);
      if (prompts.length === 2) {
        const receipt = JSON.parse(request.messages.at(-1)!.content);
        expect(receipt).toEqual({ characters: 11, words: 2, lines: 1 });
        return response("", [
          {
            id: "call-two",
            name: "tool_1",
            arguments: { input: `${receipt.words} words` },
          },
        ]);
      }
      expect(JSON.parse(request.messages.at(-1)!.content)).toEqual({
        characters: 7,
        words: 2,
        lines: 1,
      });
      return response("There are two words.");
    },
    async (_resource, input) => {
      called.push(input);
      const text = String(input);
      return {
        characters: text.length,
        words: text.split(" ").length,
        lines: 1,
      };
    },
  );
  try {
    expect(await runToolLoop(context)).toBe("There are two words.");
    expect(called).toEqual(["Hello world", "2 words"]);
    expect(prompts.map((r) => r.messages.length)).toEqual([2, 4, 6]);
    expect(budget.calls).toBe(5);
  } finally {
    budget.dispose();
  }
});
it.each(
  [
    [{ id: "invalid-name", name: "undeclared", arguments: { input: "x" } }],
    [{ id: "invalid-args", name: "tool_1", arguments: { input: 7 } }],
    [
      { id: "duplicate", name: "tool_1", arguments: { input: "a" } },
      { id: "duplicate", name: "tool_1", arguments: { input: "b" } },
    ],
  ].map((toolCalls) => ({ toolCalls })),
)(
  "validates the entire proposed batch before the first tool side effect",
  async ({ toolCalls }) => {
    let calls = 0;
    const { context, budget } = setup(
      async () => response("", toolCalls),
      async () => {
        calls++;
        return null;
      },
    );
    try {
      await expect(runToolLoop(context)).rejects.toThrow(/BLK-(TOOL|OUTPUT)-/);
      expect(calls).toBe(0);
    } finally {
      budget.dispose();
    }
  },
);
it("never repeats the same operation under a different model call id", async () => {
  let turns = 0,
    calls = 0;
  const { context, budget } = setup(
    async () =>
      response("", [
        {
          id: `call-${++turns}`,
          name: "tool_1",
          arguments: { input: "same input" },
        },
      ]),
    async () => {
      calls++;
      return { characters: 10, words: 2, lines: 1 };
    },
  );
  try {
    await expect(runToolLoop(context)).rejects.toThrow("BLK-TOOL-DUPLICATE");
    expect(calls).toBe(1);
  } finally {
    budget.dispose();
  }
});
it("stops before a last-turn tool call and does not manufacture completion", async () => {
  let calls = 0;
  const { context, budget } = setup(
    async (request) => {
      expect(request.toolChoice).toBe("none");
      return response("", [
        { id: "last", name: "tool_1", arguments: { input: "unsafe" } },
      ]);
    },
    async () => {
      calls++;
      return null;
    },
  );
  context.maxTurns = 1;
  try {
    await expect(runToolLoop(context)).rejects.toThrow("BLK-TOOL-LOOP-LIMIT");
    expect(calls).toBe(0);
  } finally {
    budget.dispose();
  }
});
it("propagates cancellation while a tool is active and ignores its late response", async () => {
  let resolve: (value: Json) => void = () => {};
  const { context, budget } = setup(
    async () =>
      response("", [
        { id: "pending", name: "tool_1", arguments: { input: "x" } },
      ]),
    async () => {
      queueMicrotask(() => budget.controller.abort(Error("BLK-RUN-005")));
      return new Promise<Json>((done) => {
        resolve = done;
      });
    },
  );
  try {
    await expect(runToolLoop(context)).rejects.toThrow("BLK-RUN-005");
    resolve({ words: 1 });
  } finally {
    budget.dispose();
  }
});
it("rejects invalid output and ungrounded final citations", async () => {
  const first = setup(
    async () =>
      response("", [
        { id: "bad-output", name: "tool_1", arguments: { input: "x" } },
      ]),
    async () => ({ bogus: true }),
  );
  try {
    await expect(runToolLoop(first.context)).rejects.toThrow("BLK-OUTPUT-001");
  } finally {
    first.budget.dispose();
  }
  const second = setup(
    async () => response("Answer [source:invented]"),
    async () => null,
  );
  try {
    await expect(runToolLoop(second.context)).rejects.toThrow("BLK-GUARD-001");
  } finally {
    second.budget.dispose();
  }
});
