// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourcePanel } from "../../apps/studio-desktop/src/app/ResourcePanel";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { createStarter } from "../../packages/test-fixtures/src";

const local = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: local.invoke }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function studio(userResources: ReturnType<typeof mcpHttpResource>[] = []) {
  const upsert = vi.fn();
  const edit = vi.fn();
  const value = {
    snapshot: { project: createStarter() },
    resources: { ready: true, error: "", registry: { resources: userResources }, map:new Map(userResources.map(resource=>[resource.resourceId,resource])), upsert },
    rpaInput:{request:vi.fn()},
    controller: { edit },
    confirm: vi.fn(),
    setMessage: vi.fn(),
  } as unknown as Studio;
  return { value, upsert, edit };
}

function mcpHttpResource() {
  return {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "mcp-server",
    kind: "mcp",
    scope: "user",
    displayName: "Search MCP",
    definition: {
      version: "1",
      permissions: ["network.request"],
      implementationRef: { kind: "adapter", id: "mcp-server-v1" },
      transport: "streamable-http",
      timeoutMs: 30000,
      networkMode: "remote",
    },
    capabilityRequirements: ["network.request"],
    secretBindings: [{ fieldId: "endpoint", secretRef: "mcp-endpoint" }],
  };
}

it("creates an HTTP tool with schemas and secret references, never endpoint or header values", async () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  fireEvent.change(screen.getByLabelText("资源范围"), { target: { value: "user" } });
  fireEvent.change(screen.getByLabelText("资源类型"), { target: { value: "tool" } });
  fireEvent.click(screen.getByRole("button", { name: "新建资源" }));
  fireEvent.change(screen.getByLabelText("工具类型"), { target: { value: "http-json-v1" } });
  expect(screen.queryByLabelText("服务端点")).toBeNull();
  expect(screen.queryByLabelText("请求头内容")).toBeNull();
  const endpointRef = screen.getByLabelText("endpoint秘密引用");
  fireEvent.change(endpointRef, { target: { value: "tool-endpoint" } });
  expect((endpointRef as HTMLInputElement).value).toBe("tool-endpoint");
  expect((screen.getAllByRole("button", { name: "从本地配置导入" })[0] as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  expect(s.upsert).toHaveBeenCalledOnce();
  expect(s.upsert.mock.calls[0][0]).toMatchObject({
    kind: "tool",
    scope: "user",
    capabilityRequirements: ["network.request"],
    definition: {
      permissions: ["network.request"],
      implementationRef: { kind: "adapter", id: "http-json-v1" },
      method: "POST",
      timeoutMs: 30000,
    },
    secretBindings: [{ fieldId: "endpoint", secretRef: "tool-endpoint" }],
  });
  expect(JSON.stringify(s.upsert.mock.calls[0][0])).not.toContain("https://");
});

it("creates a stdio MCP server with a launch secret reference and no path fields", () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  fireEvent.change(screen.getByLabelText("资源范围"), { target: { value: "user" } });
  fireEvent.change(screen.getByLabelText("资源类型"), { target: { value: "mcp" } });
  fireEvent.click(screen.getByRole("button", { name: "新建资源" }));
  fireEvent.change(screen.getByLabelText("MCP 服务类型"), { target: { value: "mcp-server-v1" } });
  fireEvent.change(screen.getByLabelText("launch秘密引用"), { target: { value: "mcp-launch" } });
  expect(screen.queryByLabelText(/bundlePath|executable|arguments|node/)).toBeNull();
  expect(screen.queryByLabelText("endpoint")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  expect(s.upsert).toHaveBeenCalledOnce();
  expect(s.upsert.mock.calls[0][0]).toMatchObject({
    kind: "mcp",
    scope: "user",
    capabilityRequirements: ["mcp.local"],
    definition: {
      version: "1",
      implementationRef: { kind: "adapter", id: "mcp-server-v1" },
      transport: "stdio",
      permissions: ["mcp.local"],
    },
    secretBindings: [{ fieldId: "launch", secretRef: "mcp-launch" }],
  });
});

it("creates a Streamable HTTP MCP server using secret references only", () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  fireEvent.change(screen.getByLabelText("资源范围"), { target: { value: "user" } });
  fireEvent.change(screen.getByLabelText("资源类型"), { target: { value: "mcp" } });
  fireEvent.click(screen.getByRole("button", { name: "新建资源" }));
  fireEvent.change(screen.getByLabelText("MCP 服务类型"), { target: { value: "mcp-server-v1" } });
  fireEvent.change(screen.getByLabelText("MCP 传输方式"), { target: { value: "streamable-http" } });
  fireEvent.change(screen.getByLabelText("MCP 网络范围"), { target: { value: "loopback" } });
  fireEvent.change(screen.getByLabelText("endpoint秘密引用"), { target: { value: "mcp-endpoint" } });
  expect(screen.queryByLabelText("服务端点")).toBeNull();
  expect(screen.queryByLabelText("endpoint")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  expect(s.upsert).toHaveBeenCalledOnce();
  expect(s.upsert.mock.calls[0][0]).toMatchObject({
    capabilityRequirements: ["network.request"],
    definition: {
      transport: "streamable-http",
      networkMode: "loopback",
      permissions: ["network.request"],
    },
    secretBindings: [{ fieldId: "endpoint", secretRef: "mcp-endpoint" }],
  });
  expect(JSON.stringify(s.upsert.mock.calls[0][0])).not.toContain("https://");
});

it("derives MCP tool permissions from the selected server", () => {
  const s = studio([mcpHttpResource()]);
  render(<ResourcePanel studio={s.value} />);
  fireEvent.change(screen.getByLabelText("资源范围"), { target: { value: "user" } });
  fireEvent.change(screen.getByLabelText("资源类型"), { target: { value: "tool" } });
  fireEvent.click(screen.getByRole("button", { name: "新建资源" }));
  fireEvent.change(screen.getByLabelText("工具类型"), { target: { value: "mcp-tool-v1" } });
  fireEvent.change(screen.getByLabelText("MCP 服务"), { target: { value: "mcp-server" } });
  fireEvent.change(screen.getByLabelText("MCP 工具名称"), { target: { value: "search" } });
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  expect(s.upsert).toHaveBeenCalledOnce();
  expect(s.upsert.mock.calls[0][0]).toMatchObject({
    capabilityRequirements: ["network.request"],
    definition: {
      permissions: ["network.request"],
      mcpResourceId: "mcp-server",
      toolName: "search",
    },
  });
});

it("maps a project module export to the project-scoped tool resource", () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  fireEvent.change(screen.getByLabelText("资源类型"), { target: { value: "tool" } });
  fireEvent.click(screen.getByRole("button", { name: "新建资源" }));
  fireEvent.change(screen.getByLabelText("工具类型"), { target: { value: "module-tool-v1" } });
  fireEvent.change(screen.getByLabelText("工具模块"), { target: { value: "citation-service" } });
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  expect(s.upsert).not.toHaveBeenCalled();
  expect(s.edit).toHaveBeenCalledOnce();
  const updated = s.edit.mock.calls[0][0] as (project: ReturnType<typeof createStarter>) => void;
  const project = createStarter();
  updated(project);
  expect(Object.values(project.resources).find((item) => item.kind === "tool")).toMatchObject({
    scope: "project",
    capabilityRequirements: ["module.execute"],
    definition: {
      implementationRef: { kind: "adapter", id: "module-tool-v1" },
      moduleId: "citation-service",
      exportId: "lookup-v1",
      inputSchemaRef: { kind: "schema", id: "query" },
      outputSchemaRef: { kind: "schema", id: "citations" },
    },
  });
});
