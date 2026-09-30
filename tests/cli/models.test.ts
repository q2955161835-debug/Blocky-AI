import { beforeEach, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { modelCommand } from "../../tools/blocky-cli/src/models";
import {
  modelRequestSchema,
  modelResponseSchema,
} from "../../tools/blocky-cli/src/model-schema";
import { discoveryCommand } from "../../tools/blocky-cli/src/discovery";
const mocks = vi.hoisted(() => ({ native: vi.fn(), read: vi.fn() }));
vi.mock("../../tools/blocky-cli/src/native-store", () => ({
  nativeUserOperation: mocks.native,
}));
vi.mock("../../tools/blocky-cli/src/artifacts", () => ({
  readJsonArtifact: mocks.read,
}));
const request = {
  schemaVersion: "blocky.model-request/v2",
  requestId: "request-one",
  projectId: "project-one",
  resourceId: "model-one",
  messages: [{ role: "user", content: "Public input" }],
  maxOutputTokens: 64,
  timeoutMs: 30000,
};
const response = {
  schemaVersion: "blocky.model-response/v2",
  text: "Hello",
  toolCalls: [],
  finishReason: "stop",
  model: "test-model",
  requestId: "chat-result",
  provider: "managed-local",
  transport: "local",
  usageStatus: "unavailable",
  usage: null,
};
const signal = new AbortController().signal;
it("accepts camelCase and Unicode JSON property names while retaining the resource ID rules",()=> {
  expect(modelRequestSchema.safeParse({...request,outputSchema:{type:"object",properties:{acceptanceCriteria:{type:"string"},说明:{type:"string"}},required:["acceptanceCriteria","说明"]}}).success).toBe(true);
  expect(modelRequestSchema.safeParse({...request,resourceId:"Invalid ID"}).success).toBe(false);
});
beforeEach(() => {
  mocks.native.mockReset();
  mocks.read.mockReset();
  mocks.native.mockResolvedValue({ installed: false });
  mocks.read.mockResolvedValue(request);
});
it.each(["catalog", "status", "verify", "remove", "cleanup"])(
  "dispatches model %s to the owned Host",
  async (action) => {
    const args = parse([
      "model",
      action,
      ...(action === "catalog" ? [] : ["qwen3-0.6b-q8-v1"]),
      "--json",
    ]);
    await modelCommand(args, signal);
    expect(mocks.native).toHaveBeenCalledWith(
      `provider-local-model-${action}`,
      action === "catalog" ? {} : { modelId: "qwen3-0.6b-q8-v1" },
      signal,
    );
  },
);
it("requires an explicit download or paired local artifacts and resolves paths without echoing them", async () => {
  await expect(
    modelCommand(
      parse(["model", "install", "qwen3-0.6b-q8-v1", "--backend", "cpu"]),
      signal,
    ),
  ).rejects.toMatchObject({ code: "BLK-CLI-002" });
  const result = await modelCommand(
    parse([
      "model",
      "install",
      "qwen3-0.6b-q8-v1",
      "--backend",
      "cpu",
      "--model-file",
      "private-model.gguf",
      "--runtime-file",
      "private-runtime.zip",
    ]),
    signal,
  );
  expect(mocks.native.mock.calls[0][1]).toMatchObject({
    modelId: "qwen3-0.6b-q8-v1",
    backend: "cpu",
    source: {
      modelFile: resolve("private-model.gguf"),
      runtimeFile: resolve("private-runtime.zip"),
    },
  });
  expect(JSON.stringify(result)).not.toContain("private-model");
});
it("parses download as a boolean and rejects mutually exclusive or incomplete sources", async () => {
  const args = parse([
    "model",
    "install",
    "qwen3-0.6b-q8-v1",
    "--backend",
    "vulkan",
    "--download",
    "--json",
  ]);
  expect(args.options.get("download")).toBe(true);
  await modelCommand(args, signal);
  expect(mocks.native.mock.calls[0][1]).not.toHaveProperty("source");
  for (const flags of [
    ["--model-file", "a"],
    ["--download", "--model-file", "a", "--runtime-file", "b"],
  ])
    await expect(
      modelCommand(
        parse([
          "model",
          "install",
          "qwen3-0.6b-q8-v1",
          "--backend",
          "cpu",
          ...flags,
        ]),
        signal,
      ),
    ).rejects.toMatchObject({ code: "BLK-CLI-002" });
});
it("validates preflight and generate requests and forwards approval without endpoint or secrets", async () => {
  mocks.native.mockResolvedValue({ requestDigest: "a".repeat(64) });
  await modelCommand(
    parse(["model", "preflight", "--request", "request.json"]),
    signal,
  );
  expect(mocks.native).toHaveBeenLastCalledWith(
    "provider-model-preflight",
    { request },
    signal,
  );
  mocks.native.mockResolvedValue(response);
  const result = await modelCommand(
    parse([
      "model",
      "generate",
      "--request",
      "request.json",
      "--approve",
      "a".repeat(64),
    ]),
    signal,
  );
  expect(mocks.native).toHaveBeenLastCalledWith(
    "provider-model-call",
    { request, approval: { approved: true, requestDigest: "a".repeat(64) } },
    signal,
  );
  expect(result?.result.data).toMatchObject({
    transport: "local",
    modelApiCalled: false,
    usage: null,
    usageStatus: "unavailable",
  });
});
it("reports real remote responses and preserves unavailable usage", async () => {
  mocks.native.mockResolvedValue({
    ...response,
    provider: "openai-compatible",
    transport: "remote",
  });
  const result = await modelCommand(
    parse([
      "model",
      "generate",
      "--request",
      "request.json",
      "--approve",
      "a".repeat(64),
    ]),
    signal,
  );
  expect(result?.result.data).toMatchObject({
    modelApiCalled: true,
    usage: null,
  });
  expect(modelResponseSchema.safeParse(result?.result.data).success).toBe(true);
});
it("rejects raw endpoints, unknown fields and unpaired tool replies before Host dispatch", async () => {
  for (const value of [
    { ...request, baseUrl: "https://private.invalid" },
    { ...request, apiKey: "secret" },
    {
      ...request,
      messages: [{ role: "tool", content: "result", toolCallId: "unknown" }],
    },
  ]) {
    mocks.read.mockResolvedValue(value);
    await expect(
      modelCommand(
        parse(["model", "preflight", "--request", "request.json"]),
        signal,
      ),
    ).rejects.toMatchObject({ code: "BLK-MODEL-REQUEST" });
  }
  expect(mocks.native).not.toHaveBeenCalled();
});
it("supports bounded tool-call histories, toolChoice and structured output", () => {
  expect(
    modelRequestSchema.safeParse({ ...request, toolChoice: "auto" }).success,
  ).toBe(false);
  expect(
    modelRequestSchema.safeParse({ ...request, toolChoice: "none" }).success,
  ).toBe(true);
  const tool = {
    name: "lookup",
    description: "Public lookup",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
  };
  expect(
    modelRequestSchema.safeParse({
      ...request,
      tools: [tool],
      toolChoice: "required",
      messages: [
        request.messages[0],
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call-one", name: "lookup", arguments: { city: "Paris" } },
          ],
        },
        { role: "tool", content: "France", toolCallId: "call-one" },
      ],
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      },
    }).success,
  ).toBe(true);
  expect(
    modelRequestSchema.safeParse({
      ...request,
      outputSchema: { type: "object", $ref: "file:///secret" },
    }).success,
  ).toBe(false);
  expect(
    modelResponseSchema.safeParse({
      ...response,
      usageStatus: "reported",
      usage: null,
    }).success,
  ).toBe(false);
});
it("makes request and response schemas discoverable", () => {
  const listed = discoveryCommand(parse(["schema", "list", "--json"]), [])!;
  expect(JSON.stringify(listed)).toContain("blocky.model-request/v2");
  for (const id of ["blocky.model-request/v2", "blocky.model-response/v2"])
    expect(
      discoveryCommand(parse(["schema", "show", id, "--json"]), [])?.code,
    ).toBe(0);
});
it("forwards cancellation and does not start a pre-aborted operation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    modelCommand(parse(["model", "catalog"]), controller.signal),
  ).rejects.toBeDefined();
  expect(mocks.native).not.toHaveBeenCalled();
});
