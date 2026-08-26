import { describe, expect, it } from "vitest";
import { createDeterministicModel, runProgram, type RuntimeDependencies } from "../../src/core/deterministicRuntime";
import type { BlockyProgram, IrNode } from "../../src/core/ir";
import { stableStringify, type JsonValue } from "../../src/core/json";
import { createRuntimeEvent, type RuntimeEvent } from "../../src/core/runtimeEvents";
import type { ToolContract } from "../../src/core/toolContract";

function irNode(
  id: string,
  type: string,
  options: Partial<Omit<IrNode, "id" | "type">> = {},
): IrNode {
  return { id, type, fields: {}, inputs: {}, next: null, ...options };
}

const normalProgram: BlockyProgram = {
  schemaVersion: "blocky.ir/v0-spike",
  roots: [irNode("entry", "core.event.manual_run")],
};

const normalSourceMap = { entry: { nodeId: "entry" } };

function approvedTool(): Readonly<ToolContract> {
  return Object.freeze({
    id: "mock.write",
    name: "Mock write",
    description: "",
    inputSchema: { type: "object" as const, properties: {}, required: [], additionalProperties: false as const },
    outputSchema: { type: "object" as const, properties: {}, required: [], additionalProperties: false as const },
    permissions: ["files.write"],
    requiresApproval: true,
    implementation: { kind: "mock" as const, result: {} },
  });
}

function permissionProgram(args: Record<string, JsonValue> = {}): BlockyProgram {
  return {
    schemaVersion: "blocky.ir/v0-spike",
    roots: [irNode("tool-call", "core.tool.call", {
      fields: { ARGS: args },
      inputs: { TOOL: irNode("tool-ref", "core.tool.reference", { fields: { TOOL_ID: "mock.write" } }) },
    })],
  };
}

function permissionSourceMap() {
  return {
    "tool-call": { nodeId: "tool-call" },
    "tool-ref": { nodeId: "tool-ref" },
  };
}

function twoApprovalCallsProgram(): BlockyProgram {
  return {
    schemaVersion: "blocky.ir/v0-spike",
    roots: [
      irNode("invalid-first-call", "core.tool.call", {
        fields: { ARGS: "not-an-argument-record" },
        inputs: { TOOL: irNode("invalid-first-ref", "core.tool.reference", { fields: { TOOL_ID: "mock.required" } }) },
      }),
      irNode("valid-later-call", "core.tool.call", {
        fields: { ARGS: {} },
        inputs: { TOOL: irNode("valid-later-ref", "core.tool.reference", { fields: { TOOL_ID: "mock.write" } }) },
      }),
    ],
  };
}

function twoApprovalCallsSourceMap() {
  return {
    "invalid-first-call": { nodeId: "invalid-first-call" },
    "invalid-first-ref": { nodeId: "invalid-first-ref" },
    "valid-later-call": { nodeId: "valid-later-call" },
    "valid-later-ref": { nodeId: "valid-later-ref" },
  };
}

function dependencies(overrides: Partial<RuntimeDependencies> = {}): RuntimeDependencies {
  return {
    runIdFactory: () => "run-test-001",
    model: createDeterministicModel(),
    tools: new Map(),
    requestApproval: async () => "approved",
    ...overrides,
  };
}

async function run(options: {
  program?: BlockyProgram;
  sourceMap?: Record<string, { nodeId: string }>;
  entryId?: string;
  input: string;
  runtime?: RuntimeDependencies;
  signal?: AbortSignal;
}): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const request = {
    program: options.program ?? normalProgram,
    sourceMap: options.sourceMap ?? normalSourceMap,
    ...(options.entryId ? { entryId: options.entryId } : {}),
    input: options.input,
    signal: options.signal ?? new AbortController().signal,
    dependencies: options.runtime ?? dependencies(),
    onEvent: (event: RuntimeEvent) => events.push(event),
  };
  await runProgram(request);
  return events;
}

function chatReplyProgram(replyText: string): BlockyProgram {
  const literal = irNode("lesson-literal", "core.data.literal", {
    fields: { VALUE: replyText },
  });
  const message = irNode("lesson-message", "core.message.create", {
    inputs: { CONTENT: literal },
  });
  const reply = irNode("lesson-reply", "core.message.reply", {
    inputs: { MESSAGE: message },
  });
  const entry = irNode("lesson-entry", "core.interaction.chat_entry", {
    fields: { NAME: "课程问答" },
    inputs: { HANDLER: reply },
  });
  const agent = irNode("lesson-agent", "core.agent.define", {
    fields: { NAME: "秋叶课堂讲解 Agent" },
    inputs: { MEMBERS: entry },
  });
  return { schemaVersion: "blocky.ir/v0-spike", roots: [agent] };
}

function chatReplySourceMap() {
  return Object.fromEntries([
    "lesson-agent",
    "lesson-entry",
    "lesson-reply",
    "lesson-message",
    "lesson-literal",
  ].map((id) => [id, { nodeId: id }]));
}

function agenticRagProgram(): BlockyProgram {
  const acceptText = irNode("lesson-accept-text", "core.interaction.accept_text");
  const plan = irNode("lesson-plan", "core.reason.plan");
  const retrieval = irNode("lesson-retrieve", "core.knowledge.retrieve", {
    fields: { SOURCE_ID: "knowledge.course.primary-science" },
    inputs: { PLAN: plan },
  });
  const rerank = irNode("lesson-rerank", "core.knowledge.rerank", {
    inputs: { EVIDENCE: retrieval },
  });
  const model = irNode("lesson-model", "core.model.call", {
    inputs: { CONTEXT: rerank },
  });
  const guardrail = irNode("lesson-guardrail", "core.guardrail.check_output", {
    fields: { POLICY: "只输出课程资料可支持的结论" },
    inputs: { OUTPUT: model },
  });
  const citation = irNode("lesson-cite", "core.knowledge.cite", {
    inputs: { ANSWER: guardrail },
  });
  const markdown = irNode("lesson-markdown", "core.output.markdown", {
    inputs: { CONTENT: citation },
  });
  const message = irNode("lesson-message", "core.message.create", {
    inputs: { CONTENT: markdown },
  });
  const reply = irNode("lesson-reply", "core.message.reply", {
    inputs: { MESSAGE: message },
  });
  const entry = irNode("lesson-entry", "core.interaction.chat_entry", {
    fields: { NAME: "课程问答" },
    inputs: { CAPABILITIES: acceptText, HANDLER: reply },
  });
  const agent = irNode("lesson-agent", "core.agent.define", {
    fields: { NAME: "自然科学课程助教" },
    inputs: { MEMBERS: entry },
  });
  return { schemaVersion: "blocky.ir/v0-spike", roots: [agent] };
}

function agenticRagSourceMap() {
  return Object.fromEntries([
    "lesson-agent",
    "lesson-entry",
    "lesson-accept-text",
    "lesson-reply",
    "lesson-message",
    "lesson-markdown",
    "lesson-cite",
    "lesson-guardrail",
    "lesson-model",
    "lesson-rerank",
    "lesson-retrieve",
    "lesson-plan",
  ].map((id) => [id, { nodeId: id }]));
}

describe("deterministic runtime", () => {
  it("rejects non-record event data before it can violate the frozen event contract", () => {
    expect(() => createRuntimeEvent({
      runId: "run-invalid-data",
      sequence: 1,
      type: "run.started",
      data: ["not", "a", "record"] as never,
    })).toThrowError("RUNTIME_EVENT_DATA_NOT_OBJECT");
  });

  it("streams deterministic chunks with contiguous source-mapped events", async () => {
    const events = await run({ input: "你好" });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "block.started",
      "model.chunk",
      "model.chunk",
      "block.completed",
      "run.completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.every((event) => event.eventVersion === "blocky.event/v0-spike")).toBe(true);
    expect(events.filter((event) => event.blockId).every((event) =>
      normalSourceMap[event.blockId as keyof typeof normalSourceMap] !== undefined,
    )).toBe(true);
    expect(events[2]?.data).toEqual({ text: "已收到：" });
    expect(events[3]?.data).toEqual({ text: "你好" });
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it("executes the selected chat handler and maps every evaluated block to the reply", async () => {
    const replyText = "课程资料回答。[《秋天的叶子》§2]";
    const events = await run({
      program: chatReplyProgram(replyText),
      sourceMap: chatReplySourceMap(),
      entryId: "lesson-entry",
      input: "叶子为什么会在秋天变红？",
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "block.started",
      "block.started",
      "block.started",
      "block.started",
      "block.started",
      "block.completed",
      "block.completed",
      "model.chunk",
      "block.completed",
      "block.completed",
      "block.completed",
      "run.completed",
    ]);
    expect(events.filter((event) => event.type === "block.started").map((event) => event.blockId)).toEqual([
      "lesson-agent",
      "lesson-entry",
      "lesson-reply",
      "lesson-message",
      "lesson-literal",
    ]);
    expect(events.find((event) => event.type === "model.chunk")).toMatchObject({
      blockId: "lesson-reply",
      data: { text: replyText },
    });
  });

  it("answers a multi-topic course question through one reusable evidence pipeline", async () => {
    const events = await run({
      program: agenticRagProgram(),
      sourceMap: agenticRagSourceMap(),
      entryId: "lesson-entry",
      input: "请分别解释树叶秋天变红和水循环形成降雨的原因，每个结论引用课程资料；课程资料是否说明树叶开始变红的具体摄氏温度？没有说明就标注“待核实”。",
    });

    const reply = events
      .filter((event) => event.type === "model.chunk")
      .map((event) => event.data.text)
      .join("");
    expect(reply).toContain("## 课程资料综合回答");
    expect(reply).toContain("### 1. 树叶为什么会在秋天变红");
    expect(reply).toContain("### 2. 水循环为什么会形成降雨");
    expect(reply).toContain("### 3. 资料完整性检查");
    expect(reply).toContain("- **课程依据：** [《水循环》§1]");
    expect(reply).toContain("- **树叶开始变红的具体摄氏温度：** 待核实");
    expect(events.filter((event) => event.type === "block.started").map((event) => event.blockId)).toEqual([
      "lesson-agent",
      "lesson-entry",
      "lesson-accept-text",
      "lesson-reply",
      "lesson-message",
      "lesson-markdown",
      "lesson-cite",
      "lesson-guardrail",
      "lesson-model",
      "lesson-rerank",
      "lesson-retrieve",
      "lesson-plan",
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.started",
      blockId: "lesson-retrieve",
      data: { toolId: "knowledge.course.primary-science" },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.completed",
      blockId: "lesson-retrieve",
      data: { hitCount: 2, toolId: "knowledge.course.primary-science" },
    }));
    expect(events.at(-1)?.type).toBe("run.completed");
  });

  it("publishes safe live-model identity and token usage from the provider report", async () => {
    const deterministic = createDeterministicModel();
    const events = await run({
      program: agenticRagProgram(),
      sourceMap: agenticRagSourceMap(),
      entryId: "lesson-entry",
      input: "水循环为什么会形成降雨？",
      runtime: dependencies({
        model: {
          stream: deterministic.stream,
          takeLastCallReport: () => ({
            live: true,
            provider: "deepseek",
            model: "deepseek-v4-flash",
            requestId: "response-test-001",
            promptTokens: 120,
            completionTokens: 80,
            totalTokens: 200,
          }),
        },
      }),
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: "model.completed",
      blockId: "lesson-model",
      data: {
        live: true,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        requestId: "response-test-001",
        promptTokens: 120,
        completionTokens: 80,
        totalTokens: 200,
      },
    }));
  });

  it("does not reuse another topic when the input asks only for unsupported detail", async () => {
    const events = await run({
      program: agenticRagProgram(),
      sourceMap: agenticRagSourceMap(),
      entryId: "lesson-entry",
      input: "课程资料有没有说明叶片开始变红的具体温度？",
    });

    const reply = events
      .filter((event) => event.type === "model.chunk")
      .map((event) => event.data.text)
      .join("");
    expect(reply).toContain("### 1. 资料完整性检查");
    expect(reply).toContain("- **叶片开始变红的具体温度：** 待核实");
    expect(reply).not.toMatch(/叶绿素|花青素|水循环|§1|§2/);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.completed",
      data: { hitCount: 0, toolId: "knowledge.course.primary-science" },
    }));
  });

  it("answers a separate course topic through the same Agent configuration", async () => {
    const events = await run({
      program: agenticRagProgram(),
      sourceMap: agenticRagSourceMap(),
      entryId: "lesson-entry",
      input: "绿色植物怎样通过光合作用制造养分？",
    });

    const reply = events
      .filter((event) => event.type === "model.chunk")
      .map((event) => event.data.text)
      .join("");
    expect(reply).toContain("### 1. 光合作用怎样制造养分");
    expect(reply).toContain("- **课程依据：** [《植物怎样获得养分》§1]");
    expect(reply).not.toMatch(/叶绿素|降雨|花青素/);
  });

  it("keeps a handler block active until the visual step is released", async () => {
    let releaseStep: (() => void) | undefined;
    let settled = false;
    const pacedRuntime = {
      ...dependencies(),
      waitForStep: async (blockId: string) => {
        if (blockId !== "lesson-agent") return;
        await new Promise<void>((resolve) => {
          releaseStep = resolve;
        });
      },
    };
    const events: RuntimeEvent[] = [];
    const task = runProgram({
      program: chatReplyProgram("课程资料回答"),
      sourceMap: chatReplySourceMap(),
      entryId: "lesson-entry",
      input: "叶子为什么会在秋天变红？",
      signal: new AbortController().signal,
      dependencies: pacedRuntime,
      onEvent: (event) => events.push(event),
    }).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "block.started",
    ]);
    expect(releaseStep).toBeTypeOf("function");
    releaseStep?.();
    await task;
    expect(events.at(-1)?.type).toBe("run.completed");
  });

  it("ends cancelled after an abort between model chunks and never completes", async () => {
    const controller = new AbortController();
    const events: RuntimeEvent[] = [];
    await runProgram({
      program: normalProgram,
      sourceMap: normalSourceMap,
      input: "cancel",
      signal: controller.signal,
      dependencies: dependencies(),
      onEvent: (event) => {
        events.push(event);
        if (event.type === "model.chunk") controller.abort();
      },
    });

    expect(events.at(-1)?.type).toBe("run.cancelled");
    expect(events.some((event) => event.type === "run.completed")).toBe(false);
  });

  it("surfaces the stable simulated model failure", async () => {
    const events = await run({ input: "/error" });

    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      blockId: "entry",
      data: { code: "MODEL_SIMULATED_FAILURE" },
    });
  });

  it("preserves the simulated error command when a chat entry is selected", async () => {
    const events = await run({
      program: chatReplyProgram("不应输出的课程回复"),
      sourceMap: chatReplySourceMap(),
      entryId: "lesson-entry",
      input: "/error",
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "block.started",
      "run.failed",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      blockId: "lesson-agent",
      data: { code: "MODEL_SIMULATED_FAILURE" },
    });
    expect(events.some((event) => event.type === "model.chunk")).toBe(false);
  });

  it("requests approval before executing the first approved explicit tool call", async () => {
    const runtime = dependencies({ tools: new Map([["mock.write", approvedTool()]]) });
    const events = await run({
      program: permissionProgram(),
      sourceMap: permissionSourceMap(),
      input: "/permission",
      runtime,
    });
    const permissionRequested = events.findIndex((event) => event.type === "tool.permission_requested");
    const toolStarted = events.findIndex((event) => event.type === "tool.started");

    expect(permissionRequested).toBeGreaterThan(-1);
    expect(permissionRequested).toBeLessThan(toolStarted);
    expect(events.map((event) => event.type)).toContain("tool.completed");
  });

  it("records stable denial without starting a tool", async () => {
    const runtime = dependencies({
      tools: new Map([["mock.write", approvedTool()]]),
      requestApproval: async () => "denied",
    });
    const events = await run({
      program: permissionProgram(),
      sourceMap: permissionSourceMap(),
      input: "/permission",
      runtime,
    });

    expect(events.some((event) => event.type === "tool.started")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "run.failed", data: { code: "TOOL_PERMISSION_DENIED" } });
  });

  it.each(["tool.completed", "block.completed"])("cancellation after %s wins over completion", async (abortAfter) => {
    const controller = new AbortController();
    const events: RuntimeEvent[] = [];
    await runProgram({
      program: permissionProgram(),
      sourceMap: permissionSourceMap(),
      input: "/permission",
      signal: controller.signal,
      dependencies: dependencies({ tools: new Map([["mock.write", approvedTool()]]) }),
      onEvent: (event) => {
        events.push(event);
        if (event.type === abortAfter) controller.abort();
      },
    });

    expect(events.at(-1)?.type).toBe("run.cancelled");
    expect(events.filter((event) => event.type === "run.cancelled")).toHaveLength(1);
    expect(events.some((event) => event.type === "run.completed")).toBe(false);
  });

  it("checks cancellation before publishing the event after block start", async () => {
    const controller = new AbortController();
    const events: RuntimeEvent[] = [];
    await runProgram({
      program: permissionProgram(),
      sourceMap: permissionSourceMap(),
      input: "/permission",
      signal: controller.signal,
      dependencies: dependencies({ tools: new Map([["mock.write", approvedTool()]]) }),
      onEvent: (event) => {
        events.push(event);
        if (event.type === "block.started") controller.abort();
      },
    });

    expect(events.map((event) => event.type)).not.toContain("tool.permission_requested");
    expect(events.at(-1)?.type).toBe("run.cancelled");
  });

  it("lets cancellation win when approval aborts before rejecting", async () => {
    const controller = new AbortController();
    const events = await run({
      program: permissionProgram(),
      sourceMap: permissionSourceMap(),
      input: "/permission",
      signal: controller.signal,
      runtime: dependencies({
        tools: new Map([["mock.write", approvedTool()]]),
        requestApproval: async () => {
          controller.abort();
          throw new Error("approval callback rejected");
        },
      }),
    });

    expect(events.map((event) => event.type)).not.toContain("run.failed");
    expect(events.filter((event) => event.type === "run.cancelled")).toHaveLength(1);
  });

  it("keeps an approval rejection without cancellation as a stable failure", async () => {
    const events = await run({
      program: permissionProgram(),
      sourceMap: permissionSourceMap(),
      input: "/permission",
      runtime: dependencies({
        tools: new Map([["mock.write", approvedTool()]]),
        requestApproval: async () => { throw new Error("approval callback rejected"); },
      }),
    });

    expect(events.at(-1)).toMatchObject({ type: "run.failed", data: { code: "RUNTIME_SIMULATED_FAILURE" } });
  });

  it("does not execute an invalid explicit tool call", async () => {
    const requiredTool = { ...approvedTool(), inputSchema: {
      type: "object" as const,
      properties: { destination: { type: "string" as const } },
      required: ["destination"],
      additionalProperties: false as const,
    } };
    const events = await run({
      program: permissionProgram(),
      sourceMap: permissionSourceMap(),
      input: "/permission",
      runtime: dependencies({ tools: new Map([["mock.write", requiredTool]]) }),
    });

    expect(events.some((event) => event.type === "tool.started")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "run.failed", data: { code: "TOOL_CALL_INVALID" } });
  });

  it("fails the first invalid-ARGS approval call instead of executing a later valid one", async () => {
    const requiredTool = { ...approvedTool(), id: "mock.required", inputSchema: {
      type: "object" as const,
      properties: { destination: { type: "string" as const } },
      required: ["destination"],
      additionalProperties: false as const,
    } };
    const events = await run({
      program: twoApprovalCallsProgram(),
      sourceMap: twoApprovalCallsSourceMap(),
      input: "/permission",
      runtime: dependencies({ tools: new Map([
        ["mock.required", requiredTool],
        ["mock.write", approvedTool()],
      ]) }),
    });

    expect(events.map((event) => event.type)).not.toContain("tool.permission_requested");
    expect(events.map((event) => event.type)).not.toContain("tool.started");
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      blockId: "invalid-first-call",
      data: { code: "TOOL_CALL_INVALID" },
    });
  });

  it("redacts sensitive event data before it is observed", async () => {
    const fakeToken = ["sk", "-", "test", "A".repeat(24)].join("");
    const events = await run({ input: fakeToken });
    const observed = stableStringify(events);

    expect(observed).not.toContain(fakeToken);
    expect(observed).toContain("[REDACTED:model-token]");
  });
});
