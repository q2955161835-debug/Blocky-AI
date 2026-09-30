import { expect, it } from "vitest";
import { createAgentExample } from "../../block-catalog/src";
import { resourceDefinitions, validateResource } from "../src";

const reference = (id: string) => ({ kind: "schema", id });
function resource(
  kind: string,
  definition: Record<string, unknown>,
  options: {
    scope?: "project" | "user";
    permissions?: string[];
    capabilities?: string[];
    secretBindings?: { fieldId: string; secretRef: string }[];
  } = {},
) {
  return {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: `${kind}-resource`,
    kind,
    scope: options.scope ?? "user",
    displayName: `${kind} resource`,
    definition,
    capabilityRequirements: options.capabilities ?? [],
    secretBindings: options.secretBindings ?? [],
  };
}
function tool(
  adapter: string,
  fields: Record<string, unknown> = {},
  options: Parameters<typeof resource>[2] = {},
) {
  return resource(
    "tool",
    {
      version: "1",
      permissions: options?.permissions ?? [],
      implementationRef: { kind: "adapter", id: adapter },
      inputSchemaRef: reference("tool-input"),
      outputSchemaRef: reference("tool-output"),
      inputSchemaJson:
        '{"type":"object","properties":{"input":{"type":"string"}},"required":["input"],"additionalProperties":false}',
      outputSchemaJson: '{"type":"string"}',
      timeoutMs: 30000,
      ...fields,
    },
    options,
  );
}
const networkSecrets = [{ fieldId: "endpoint", secretRef: "tool-endpoint" }];

it("publishes self-contained tool and MCP server schemas without changing the legacy tool binding", () => {
  const toolDefinition = resourceDefinitions.find(
    (item) => item.kind === "tool",
  )!;
  expect(toolDefinition.secretFields).toEqual(
    expect.arrayContaining(["endpoint", "headers"]),
  );
  expect(toolDefinition.definitionSchema.properties).toMatchObject({
    inputSchemaJson: {
      type: "string",
      format: "json-schema",
      maxLength: 16384,
    },
    outputSchemaJson: {
      type: "string",
      format: "json-schema",
      maxLength: 16384,
    },
    timeoutMs: { type: "number", minimum: 1, maximum: 120000 },
    method: { type: "string", enum: ["GET", "POST"] },
    networkMode: { type: "string", enum: ["remote", "loopback"] },
  });
  expect(
    resourceDefinitions.find((item) => item.kind === "mcp")?.secretFields,
  ).toEqual(expect.arrayContaining(["endpoint", "headers", "launch"]));

  const legacy = createAgentExample("legacy-text-analyzer").resources[
    "text-tool"
  ];
  expect(validateResource(legacy)).toEqual(legacy);
});

it("validates HTTP and search tools with bounded JSON Schemas and secret-only endpoints", () => {
  for (const adapter of ["http-json-v1", "search-json-v1"]) {
    const accepted = tool(
      adapter,
      {
        method: "POST",
        networkMode: "remote",
        permissions: ["network.request"],
      },
      {
        permissions: ["network.request"],
        capabilities: ["network.request"],
        secretBindings: networkSecrets,
      },
    );
    expect(validateResource(accepted).definition.implementationRef).toEqual({
      kind: "adapter",
      id: adapter,
    });
    for (const invalid of [
      { ...accepted, secretBindings: [] },
      {
        ...accepted,
        definition: {
          ...accepted.definition,
          endpoint: "https://api.example.com",
        },
      },
      {
        ...accepted,
        definition: {
          ...accepted.definition,
          permissions: ["network.request", "shell"],
        },
      },
      {
        ...accepted,
        capabilityRequirements: ["network.request", "filesystem.read"],
      },
      {
        ...accepted,
        definition: { ...accepted.definition, timeoutMs: 120001 },
      },
      { ...accepted, definition: { ...accepted.definition, method: "DELETE" } },
      {
        ...accepted,
        definition: { ...accepted.definition, inputSchemaJson: "not-json" },
      },
      {
        ...accepted,
        definition: {
          ...accepted.definition,
          inputSchemaJson: JSON.stringify({ note: "x".repeat(16384) }),
        },
      },
      { ...accepted, scope: "project" },
    ])
      expect(() => validateResource(invalid)).toThrow("BLK-RESOURCE-003");
  }
});

it("validates MCP server transport, exact capabilities, and secret-backed launch or endpoint", () => {
  const stdio = resource(
    "mcp",
    {
      version: "1",
      permissions: ["mcp.local"],
      implementationRef: { kind: "adapter", id: "mcp-server-v1" },
      transport: "stdio",
      timeoutMs: 30000,
    },
    {
      capabilities: ["mcp.local"],
      secretBindings: [{ fieldId: "launch", secretRef: "mcp-launch" }],
    },
  );
  expect(validateResource(stdio).secretBindings).toEqual([
    { fieldId: "launch", secretRef: "mcp-launch" },
  ]);
  const http = resource(
    "mcp",
    {
      version: "1",
      permissions: ["network.request"],
      implementationRef: { kind: "adapter", id: "mcp-server-v1" },
      transport: "streamable-http",
      timeoutMs: 60000,
      networkMode: "loopback",
    },
    {
      capabilities: ["network.request"],
      secretBindings: [
        { fieldId: "endpoint", secretRef: "mcp-endpoint" },
        { fieldId: "headers", secretRef: "mcp-headers" },
      ],
    },
  );
  expect(validateResource(http).definition.networkMode).toBe("loopback");
  for (const invalid of [
    { ...stdio, secretBindings: [] },
    {
      ...stdio,
      definition: { ...stdio.definition, endpoint: "https://mcp.example.com" },
    },
    {
      ...stdio,
      definition: {
        ...stdio.definition,
        permissions: ["mcp.local", "network.request"],
      },
    },
    {
      ...stdio,
      secretBindings: [
        ...stdio.secretBindings,
        { fieldId: "access", secretRef: "access" },
      ],
    },
    { ...http, secretBindings: [{ fieldId: "headers", secretRef: "headers" }] },
    { ...http, definition: { ...http.definition, networkMode: "public" } },
    { ...http, definition: { ...http.definition, timeoutMs: 0 } },
    {
      ...http,
      secretBindings: [
        ...http.secretBindings,
        { fieldId: "access", secretRef: "access" },
      ],
    },
  ])
    expect(() => validateResource(invalid)).toThrow("BLK-RESOURCE-003");
});

it("validates MCP-tool and module-tool adapters with their required permission boundaries", () => {
  const mcpTool = tool(
    "mcp-tool-v1",
    { mcpResourceId: "server-one", toolName: "lookup" },
    { permissions: ["mcp.local"], capabilities: ["mcp.local"] },
  );
  expect(validateResource(mcpTool).definition.mcpResourceId).toBe("server-one");
  const moduleTool = tool(
    "module-tool-v1",
    {
      moduleId: "citation-service",
      exportId: "lookup",
      permissions: ["module.execute"],
    },
    {
      scope: "project",
      permissions: ["module.execute"],
      capabilities: ["module.execute"],
    },
  );
  expect(validateResource(moduleTool).definition.exportId).toBe("lookup");
  expect(() =>
    validateResource({
      ...mcpTool,
      definition: { ...mcpTool.definition, permissions: ["filesystem.read"] },
    }),
  ).toThrow("BLK-RESOURCE-003");
  expect(() => validateResource({ ...moduleTool, scope: "user" })).toThrow(
    "BLK-RESOURCE-003",
  );
});
