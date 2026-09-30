import { beforeEach, expect, it, vi } from "vitest";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { toolCommand, toolHelp } from "../../tools/blocky-cli/src/tools";
import { toolRequestSchema } from "../../tools/blocky-cli/src/tool-schema";
import { discoveryCommand } from "../../tools/blocky-cli/src/discovery";
import { errorGuidance } from "../../tools/blocky-cli/src/error-guidance";
const mocks = vi.hoisted(() => ({ native: vi.fn(), read: vi.fn() }));
vi.mock("../../tools/blocky-cli/src/native-store", () => ({
  nativeUserOperation: mocks.native,
}));
vi.mock("../../tools/blocky-cli/src/artifacts", () => ({
  readJsonArtifact: mocks.read,
}));
const request = {
  schemaVersion: "blocky.tool-request/v2",
  projectId: "project-one",
  runId: "run-one",
  requestId: "request-one",
  resourceId: "tool-one",
  action: "call",
  input: { query: "public question" },
  timeoutMs: 30000,
};
const signal = new AbortController().signal;
beforeEach(() => {
  mocks.native.mockReset();
  mocks.read.mockReset();
  mocks.read.mockResolvedValue(request);
  mocks.native.mockResolvedValue({ requestDigest: "a".repeat(64) });
});
it("forwards preflight and explicit approval without implicit execution", async () => {
  await toolCommand(
    parse(["tool", "preflight", "--request", "request.json"]),
    signal,
  );
  expect(mocks.native).toHaveBeenLastCalledWith(
    "tool-preflight",
    { request },
    signal,
  );
  await toolCommand(
    parse([
      "tool",
      "call",
      "--request",
      "request.json",
      "--approve",
      "a".repeat(64),
    ]),
    signal,
  );
  expect(mocks.native).toHaveBeenLastCalledWith(
    "tool-call",
    { request, approval: { approved: true, requestDigest: "a".repeat(64) } },
    signal,
  );
  expect(mocks.native).toHaveBeenCalledTimes(2);
});
it.each(["discover", "read-resource"])(
  "retains explicit MCP %s action and approval",
  async (action) => {
    const r = {
      ...request,
      action,
      input: action === "discover" ? {} : { uriRef: "uri-" + "b".repeat(64) },
    };
    mocks.read.mockResolvedValue(r);
    await toolCommand(
      parse([
        "tool",
        "call",
        "--request",
        "request.json",
        "--approve",
        "a".repeat(64),
      ]),
      signal,
    );
    expect(mocks.native).toHaveBeenLastCalledWith(
      "tool-call",
      {
        request: r,
        approval: { approved: true, requestDigest: "a".repeat(64) },
      },
      signal,
    );
  },
);
it("rejects unknown fields and bounded or malformed action inputs", () => {
  for (const r of [
    { ...request, endpoint: "https://private.test" },
    { ...request, headers: {} },
    { ...request, launch: {} },
    { ...request, timeoutMs: 0 },
    { ...request, timeoutMs: 120001 },
    { ...request, resourceId: "invalid ID" },
    { ...request, action: "discover", input: { q: 1 } },
    {
      ...request,
      action: "read-resource",
      input: { uriRef: "https://private.test" },
    },
    {
      ...request,
      action: "read-resource",
      input: { uriRef: "uri-" + "A".repeat(64) },
    },
    {
      ...request,
      action: "read-resource",
      input: { uriRef: "uri-" + "a".repeat(64), extra: true },
    },
    { ...request, input: "城".repeat(11000) },
  ])
    expect(toolRequestSchema.safeParse(r).success).toBe(false);
  let deep: unknown = 0;
  for (let n = 0; n < 34; n++) deep = [deep];
  expect(toolRequestSchema.safeParse({ ...request, input: deep }).success).toBe(
    false,
  );
  expect(toolRequestSchema.safeParse(request).success).toBe(true);
});
it("invalid requests, approval and unknown flags never reach Host", async () => {
  mocks.read.mockResolvedValue({
    ...request,
    endpoint: "https://private.test",
  });
  await expect(
    toolCommand(parse(["tool", "preflight", "--request", "r"]), signal),
  ).rejects.toMatchObject({ code: "BLK-TOOL-INVALID" });
  mocks.read.mockResolvedValue(request);
  for (const args of [
    ["tool", "call", "--request", "r"],
    ["tool", "call", "--request", "r", "--approve", "wrong"],
    ["tool", "preflight", "--request", "r", "--approve", "a".repeat(64)],
    ["tool", "cleanup", "--approve", "a".repeat(64)],
  ])
    await expect(toolCommand(parse(args), signal)).rejects.toMatchObject({
      code: "BLK-CLI-002",
    });
  expect(mocks.native).not.toHaveBeenCalled();
});
it("status preserves unknown receipts and gives recovery guidance without replay", async () => {
  const value = {
    receipts: [
      { projectId: "project-one", requestId: "request-one", status: "unknown" },
    ],
  };
  mocks.native.mockResolvedValue(value);
  const result = await toolCommand(
    parse(["tool", "status", "--project-id", "project-one"]),
    signal,
  );
  expect(mocks.native).toHaveBeenCalledExactlyOnceWith(
    "tool-status",
    { projectId: "project-one" },
    signal,
  );
  expect(result?.result.data).toEqual(value);
  expect(result?.result.warnings.join()).toContain("reconcile");
});
it("reconcile requires a preflight digest and validated identifiers/outcome", async () => {
  const flags = [
    "--project-id",
    "project-one",
    "--request-id",
    "request-one",
    "--outcome",
    "confirmed-not-applied",
  ];
  await toolCommand(parse(["tool", "reconcile-preflight", ...flags]), signal);
  expect(mocks.native).toHaveBeenLastCalledWith(
    "tool-reconcile-preflight",
    {
      projectId: "project-one",
      requestId: "request-one",
      outcome: "confirmed-not-applied",
    },
    signal,
  );
  await toolCommand(
    parse(["tool", "reconcile", ...flags, "--approve", "a".repeat(64)]),
    signal,
  );
  expect(mocks.native).toHaveBeenLastCalledWith(
    "tool-reconcile",
    {
      projectId: "project-one",
      requestId: "request-one",
      outcome: "confirmed-not-applied",
      approval: { approved: true, requestDigest: "a".repeat(64) },
    },
    signal,
  );
  mocks.native.mockClear();
  for (const args of [
    ["tool", "reconcile", ...flags],
    [
      "tool",
      "reconcile-preflight",
      "--project-id",
      "bad ID",
      "--request-id",
      "r",
      "--outcome",
      "confirmed-completed",
    ],
    [
      "tool",
      "reconcile-preflight",
      "--project-id",
      "p",
      "--request-id",
      "r",
      "--outcome",
      "retry",
    ],
  ])
    await expect(toolCommand(parse(args), signal)).rejects.toMatchObject({
      code: "BLK-CLI-002",
    });
  expect(mocks.native).not.toHaveBeenCalled();
});
it.each(["cleanup", "cleanup-status"])(
  "dispatches explicit %s without fields or extra approval",
  async (action) => {
    await toolCommand(parse(["tool", action, "--json"]), signal);
    expect(mocks.native).toHaveBeenLastCalledWith(`tool-${action}`, {}, signal);
  },
);
it("passes AbortSignal and refuses an already canceled command", async () => {
  const c = new AbortController();
  c.abort();
  await expect(
    toolCommand(parse(["tool", "cleanup"]), c.signal),
  ).rejects.toThrow();
  expect(mocks.native).not.toHaveBeenCalled();
});
it("makes request schema and MCP actions discoverable without secrets", () => {
  const result = discoveryCommand(
    parse(["schema", "show", "blocky.tool-request/v2"]),
    toolHelp,
  );
  expect(result?.result.data).toMatchObject({
    schemaId: "blocky.tool-request/v2",
  });
  const text = JSON.stringify(result);
  expect(text).toContain("read-resource");
  expect(text).not.toContain("endpoint");
  const commands = discoveryCommand(
    parse(["command", "list", "--query", "tool"]),
    toolHelp,
  );
  expect(JSON.stringify(commands)).toContain("reconcile-preflight");
});
it("routes tool commands through the shared dispatcher", async () => {
  const { dispatch, help } = await import(
    "../../tools/blocky-cli/src/commands"
  );
  await dispatch(parse(["tool", "cleanup-status"]), () => {}, signal);
  expect(mocks.native).toHaveBeenLastCalledWith(
    "tool-cleanup-status",
    {},
    signal,
  );
  expect(help.commands).toContain(
    "tool call --request <request.json> --approve <sha256> --json",
  );
});
it("explains unknown outcomes and transport failures with a recovery path", () => {
  for (const code of [
    "BLK-TOOL-RECOVERY-REQUIRED",
    "BLK-TOOL-INTERRUPTED",
    "BLK-TOOL-HTTP-TRANSPORT",
    "BLK-MCP-SESSION-EXPIRED",
  ])
    expect(errorGuidance(code)?.hint).toContain("reconcile");
});
