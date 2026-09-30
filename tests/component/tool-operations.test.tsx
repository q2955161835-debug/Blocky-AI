// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Resource } from "../../packages/language-schema/src";
import { ResourcePanel } from "../../apps/studio-desktop/src/app/ResourcePanel";
import { ToolOperationsPanel } from "../../apps/studio-desktop/src/app/ToolOperationsPanel";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { createStarter } from "../../packages/test-fixtures/src";

const local = vi.hoisted(() => ({ invoke: vi.fn() }));
let nextId = 0;
beforeEach(() => {
  nextId = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `test-${++nextId}` });
  (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof local.invoke } }).__TAURI_INTERNALS__ = {
    invoke: local.invoke,
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

const httpTool: Resource = {
  schemaVersion: "blocky.resource/v1alpha1",
  resourceId: "tool-saved",
  kind: "tool",
  scope: "user",
  displayName: "Saved HTTP tool",
  definition: {
    version: "1",
    permissions: ["network.request"],
    implementationRef: { kind: "adapter", id: "http-json-v1" },
    inputSchemaRef: { kind: "schema", id: "query" },
    outputSchemaRef: { kind: "schema", id: "answer" },
    inputSchemaJson: '{"type":"object"}',
    outputSchemaJson: '{"type":"object"}',
    method: "POST",
    networkMode: "remote",
    timeoutMs: 30000,
  },
  capabilityRequirements: ["network.request"],
  secretBindings: [{ fieldId: "endpoint", secretRef: "endpoint-ref" }],
};
const mcpServer: Resource = {
  schemaVersion: "blocky.resource/v1alpha1",
  resourceId: "mcp-saved",
  kind: "mcp",
  scope: "user",
  displayName: "Saved MCP server",
  definition: {
    version: "1",
    permissions: ["mcp.local"],
    implementationRef: { kind: "adapter", id: "mcp-server-v1" },
    transport: "stdio",
    timeoutMs: 30000,
  },
  capabilityRequirements: ["mcp.local"],
  secretBindings: [{ fieldId: "launch", secretRef: "launch-ref" }],
};

function studio(resources: Resource[] = [httpTool]) {
  const value = {
    snapshot: { project: createStarter() },
    resources: { ready: true, error: "", registry: { resources }, upsert: vi.fn() },
    controller: { edit: vi.fn() },
    confirm: vi.fn(),
    setMessage: vi.fn(),
  } as unknown as Studio;
  return value;
}

function selectOperationsResource(resourceId: string) {
  fireEvent.change(screen.getByLabelText("工具操作资源"), {
    target: { value: resourceId },
  });
}

it("sends a fresh request through preflight and shows the actual tool result", async () => {
  local.invoke.mockImplementation(async (command: string) => {
    if (command === "tool_status") return { receipts: [] };
    if (command === "tool_cleanup_status") return { incompleteSessions: 0, incompleteBytes: 0 };
    if (command === "tool_preflight") return { unresolvedCalls: 0, requestDigest: "a".repeat(64) };
    if (command === "tool_call") return { answer: "two" };
    return {};
  });
  render(<ResourcePanel studio={studio()} />);
  selectOperationsResource("tool-saved");
  fireEvent.change(screen.getByLabelText("工具输入 JSON"), {
    target: { value: '{"query":"two public words"}' },
  });
  fireEvent.click(screen.getByRole("button", { name: "调用已保存工具" }));
  await waitFor(() => expect(JSON.parse(screen.getByLabelText("工具返回 JSON").textContent ?? "{}")).toEqual({ answer: "two" }));
  const preflight = local.invoke.mock.calls.find(([name]) => name === "tool_preflight");
  const call = local.invoke.mock.calls.find(([name]) => name === "tool_call");
  expect(preflight?.[1]).toEqual({ request: call?.[1]?.request });
  expect(call?.[1]?.request).toMatchObject({
    schemaVersion: "blocky.tool-request/v2",
    projectId: "research-workbench",
    resourceId: "tool-saved",
    action: "call",
    input: { query: "two public words" },
    timeoutMs: 30000,
  });
  expect(call?.[1]?.request.runId).not.toBe(call?.[1]?.request.requestId);
});

it("discovers MCP resources and reads only the selected uriRef", async () => {
  const discovered = {
    tools: [{ name: "lookup", description: "Search" }],
    resources: [{ uriRef: `uri-${"a".repeat(64)}`, name: "Guide", mimeType: "text/plain" }],
  };
  local.invoke.mockImplementation(async (command: string, args: { request?: { action: string } }) => {
    if (command === "tool_status") return { receipts: [] };
    if (command === "tool_cleanup_status") return { incompleteSessions: 0, incompleteBytes: 0 };
    if (command === "tool_preflight") return { unresolvedCalls: 0, requestDigest: "b".repeat(64) };
    if (command === "tool_call" && args.request?.action === "discover") return discovered;
    if (command === "tool_call" && args.request?.action === "read-resource") return { uriRef: discovered.resources[0].uriRef, contents: [{ text: "Actual result", mimeType: "text/plain" }] };
    return {};
  });
  render(<ResourcePanel studio={studio([mcpServer])} />);
  selectOperationsResource("mcp-saved");
  fireEvent.click(screen.getByRole("button", { name: "发现 MCP 工具和资料" }));
  await waitFor(() => expect(screen.getByLabelText("MCP 资料")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("MCP 资料"), { target: { value: discovered.resources[0].uriRef } });
  fireEvent.click(screen.getByRole("button", { name: "读取所选资料" }));
  await waitFor(() => expect(screen.getByLabelText("工具返回 JSON").textContent).toContain("Actual result"));
  const calls = local.invoke.mock.calls.filter(([name]) => name === "tool_call");
  expect(calls).toHaveLength(2);
  expect(calls[0]?.[1]?.request).toMatchObject({ action: "discover", input: {} });
  expect(calls[1]?.[1]?.request).toMatchObject({ action: "read-resource", input: { uriRef: discovered.resources[0].uriRef } });
  expect(JSON.stringify(calls[1]?.[1]?.request)).not.toContain("file://");
});

it("shows temporary-session cleanup state and refreshes it after cleanup", async () => {
  let incompleteSessions = 2;
  local.invoke.mockImplementation(async (command: string) => {
    if (command === "tool_status") return { receipts: [] };
    if (command === "tool_cleanup_status") return { incompleteSessions, incompleteBytes: incompleteSessions * 512 };
    if (command === "tool_cleanup") {
      incompleteSessions = 0;
      return { removedSessions: 2, removedBytes: 1024 };
    }
    return {};
  });
  render(<ResourcePanel studio={studio()} />);
  selectOperationsResource("tool-saved");
  await waitFor(() => expect(screen.getByText(/已识别未完成会话 2 个/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "清理已识别的临时资料" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已清理 2 个会话"));
  await waitFor(() => expect(screen.getByText(/已识别未完成会话 0 个/)).toBeTruthy());
  expect(local.invoke.mock.calls.some(([name]) => name === "tool_cleanup")).toBe(true);
  expect(local.invoke.mock.calls.filter(([name]) => name === "tool_cleanup_status")).toHaveLength(2);
});

it("keeps a cancelled call busy until settlement and requires explicit unknown receipt reconciliation", async () => {
  let rejectCall: ((reason?: unknown) => void) | undefined;
  let activeRequestId = "";
  let receiptStatus: "running" | "unknown" | "confirmed-completed" = "running";
  local.invoke.mockImplementation((command: string, args: { request?: { requestId: string } } = {}) => {
    if (command === "tool_status") return Promise.resolve({ receipts: receiptStatus === "running" ? [] : [{ requestId: activeRequestId, resourceId: "tool-saved", status: receiptStatus }] });
    if (command === "tool_cleanup_status") return Promise.resolve({ incompleteSessions: 0, incompleteBytes: 0 });
    if (command === "tool_preflight") return Promise.resolve({ unresolvedCalls: 0, requestDigest: "c".repeat(64) });
    if (command === "tool_call") { activeRequestId = args.request!.requestId; return new Promise((_, reject) => { rejectCall = reject; }); }
    if (command === "tool_cancel") return Promise.resolve();
    if (command === "tool_reconcile") {
      receiptStatus = "confirmed-completed";
      return Promise.resolve({ requestId: activeRequestId, status: receiptStatus });
    }
    return Promise.resolve({});
  });
  render(<ResourcePanel studio={studio()} />);
  selectOperationsResource("tool-saved");
  fireEvent.click(screen.getByRole("button", { name: "调用已保存工具" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "停止工具请求" })).toBeTruthy());
  expect(screen.getByLabelText("工具输入 JSON").closest("fieldset")?.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "停止工具请求" }));
  await waitFor(() => expect(local.invoke.mock.calls.some(([name]) => name === "tool_cancel")).toBe(true));
  expect((screen.getByRole("button", { name: "停止工具请求" }) as HTMLButtonElement).disabled).toBe(false);
  receiptStatus = "unknown";
  rejectCall?.("BLK-TOOL-CANCELLED");
  await waitFor(() => expect(screen.getByRole("button", { name: "记录结果已生效" })).toBeTruthy());
  expect(local.invoke.mock.calls.filter(([name]) => name === "tool_call")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "记录结果已生效" }));
  await waitFor(() => expect(local.invoke.mock.calls.some(([name, args]) => name === "tool_reconcile" && args?.outcome === "confirmed-completed")).toBe(true));
  expect(local.invoke.mock.calls.filter(([name]) => name === "tool_call")).toHaveLength(1);
});

it("does not send tool_call when stop is requested during preflight", async () => {
  let resolvePreflight: ((value: { unresolvedCalls: number; requestDigest: string; inputBytes: number }) => void) | undefined;
  local.invoke.mockImplementation((command: string) => {
    if (command === "tool_status") return Promise.resolve({ receipts: [] });
    if (command === "tool_cleanup_status") return Promise.resolve({ incompleteSessions: 0, incompleteBytes: 0 });
    if (command === "tool_preflight") return new Promise((resolve) => { resolvePreflight = resolve; });
    if (command === "tool_cancel") return Promise.resolve();
    return Promise.resolve({});
  });
  const onBusyChange = vi.fn();
  render(<ToolOperationsPanel resource={httpTool} projectId="research-workbench" onBusyChange={onBusyChange} />);
  fireEvent.click(screen.getByRole("button", { name: "调用已保存工具" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "停止工具请求" })).toBeTruthy());
  const preflight = local.invoke.mock.calls.find(([name]) => name === "tool_preflight");
  fireEvent.click(screen.getByRole("button", { name: "停止工具请求" }));
  await waitFor(() => expect(local.invoke.mock.calls.some(([name]) => name === "tool_cancel")).toBe(true));
  resolvePreflight?.({ unresolvedCalls: 0, requestDigest: "d".repeat(64), inputBytes: 2 });
  await waitFor(() => expect(onBusyChange.mock.calls.at(-1)?.[0]).toBe(false));
  expect(local.invoke.mock.calls.filter(([name]) => name === "tool_call")).toHaveLength(0);
  expect(local.invoke.mock.calls.find(([name]) => name === "tool_cancel")?.[1]).toEqual({ requestId: preflight?.[1]?.request.requestId });
});

it("cancels an in-flight request on unmount and stays busy until it settles", async () => {
  let rejectCall: ((reason?: unknown) => void) | undefined;
  local.invoke.mockImplementation((command: string) => {
    if (command === "tool_status") return Promise.resolve({ receipts: [] });
    if (command === "tool_cleanup_status") return Promise.resolve({ incompleteSessions: 0, incompleteBytes: 0 });
    if (command === "tool_preflight") return Promise.resolve({ unresolvedCalls: 0, requestDigest: "e".repeat(64), inputBytes: 2 });
    if (command === "tool_call") return new Promise((_, reject) => { rejectCall = reject; });
    if (command === "tool_cancel") return Promise.resolve();
    return Promise.resolve({});
  });
  const onBusyChange = vi.fn();
  const view = render(<ToolOperationsPanel resource={httpTool} projectId="research-workbench" onBusyChange={onBusyChange} />);
  fireEvent.click(screen.getByRole("button", { name: "调用已保存工具" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "停止工具请求" })).toBeTruthy());
  const call = local.invoke.mock.calls.find(([name]) => name === "tool_call");
  view.unmount();
  await waitFor(() => expect(local.invoke.mock.calls.some(([name]) => name === "tool_cancel")).toBe(true));
  expect(onBusyChange.mock.calls.at(-1)?.[0]).toBe(true);
  expect(local.invoke.mock.calls.find(([name]) => name === "tool_cancel")?.[1]).toEqual({ requestId: call?.[1]?.request.requestId });
  rejectCall?.("BLK-TOOL-CANCELLED");
  await waitFor(() => expect(onBusyChange.mock.calls.at(-1)?.[0]).toBe(false));
});
