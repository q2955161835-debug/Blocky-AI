import type { Resource } from "@blocky/language-schema";
import { resourceDefinitions, type ResourceFieldSchema } from "./definitions";

export function invalidResource(): never {
  throw Error("BLK-RESOURCE-003: Invalid resource configuration");
}
export function validResourceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function publicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[\\\s]/.test(value)
    )
      return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    // IP literals are deliberately unsupported: public endpoints use qualified DNS names.
    if (!host.includes(".") || host.includes(":") || /^[\d.]+$/.test(host))
      return false;
    const labels = host.split(".");
    if (
      labels.some(
        (label) =>
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label) ||
          label === "localhost",
      )
    )
      return false;
    return !/\.(local|internal|lan|home|localhost|invalid|test)$/.test(host);
  } catch {
    return false;
  }
}

function check(value: unknown, schema: ResourceFieldSchema, depth = 0): void {
  if (depth > 16) invalidResource();
  if (schema.type === "object") {
    if (!record(value)) invalidResource();
    const properties = schema.properties ?? {};
    if (Object.keys(value).some((key) => !Object.hasOwn(properties, key)))
      invalidResource();
    if (schema.required?.some((key) => !Object.hasOwn(value, key)))
      invalidResource();
    for (const [key, item] of Object.entries(value))
      check(item, properties[key], depth + 1);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > 1000 || !schema.items)
      invalidResource();
    for (const item of value) check(item, schema.items, depth + 1);
  } else if (schema.type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.integer && !Number.isInteger(value)) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum)
    )
      invalidResource();
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > (schema.maxLength ?? 2048) ||
      (schema.format === "json-schema"
        ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
        : /[\u0000-\u001f]/.test(value))
    )
      invalidResource();
    if (schema.format === "json-schema") {
      if (new TextEncoder().encode(value).length > (schema.maxLength ?? 32768))
        invalidResource();
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        invalidResource();
      }
      assertBoundedJsonSchema(parsed);
      return;
    }
    if (
      /^(?:Bearer\s|sk-)|(?:api[_-]?key|authorization|password|cookie)\s*[:=]/i.test(
        value,
      )
    )
      invalidResource();
    if (
      schema.format !== "public-https" &&
      /(?:https?:\/\/|[A-Za-z]:\\|^\\\\)/i.test(value)
    )
      invalidResource();
    if (schema.enum && !schema.enum.includes(value)) invalidResource();
    if (schema.format === "id" && !validResourceId(value)) invalidResource();
    if (schema.format === "public-https" && !publicHttps(value))
      invalidResource();
  } else if (typeof value !== "boolean") invalidResource();
}

function assertBoundedJsonSchema(value: unknown): void {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 1000 || depth > 16) invalidResource();
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) invalidResource();
      return;
    }
    if (typeof item === "string") {
      if (
        item.length > 2048 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item)
      )
        invalidResource();
      return;
    }
    if (Array.isArray(item)) {
      if (item.length > 1000) invalidResource();
      item.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (
      !record(item) ||
      Object.keys(item).some(
        (key) =>
          key === "__proto__" ||
          key === "prototype" ||
          key === "constructor" ||
          key.length > 128,
      )
    )
      invalidResource();
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  if (!record(value)) invalidResource();
  visit(value, 0);
}

function exactOne(values: unknown, expected: string): boolean {
  return Array.isArray(values) && values.length === 1 && values[0] === expected;
}

function hasSecret(bindings: Set<string>, field: string): boolean {
  return bindings.has(field);
}

function adapterId(config: Record<string, unknown>): string | undefined {
  const ref = config.implementationRef;
  return record(ref) && ref.kind === "adapter" && typeof ref.id === "string"
    ? ref.id
    : undefined;
}

function requireToolSchemas(config: Record<string, unknown>): void {
  for (const key of ["inputSchemaRef", "outputSchemaRef"] as const) {
    const reference = config[key];
    if (
      !record(reference) ||
      reference.kind !== "schema" ||
      !validResourceId(reference.id)
    )
      invalidResource();
  }
  for (const key of ["inputSchemaJson", "outputSchemaJson"] as const) {
    const value = config[key];
    if (typeof value !== "string") invalidResource();
    check(value, { type: "string", format: "json-schema", maxLength: 16384 });
  }
  if (
    !Number.isInteger(config.timeoutMs) ||
    Number(config.timeoutMs) < 1 ||
    Number(config.timeoutMs) > 120000
  )
    invalidResource();
}

function validateNewTool(
  input: Record<string, any>,
  config: Record<string, unknown>,
  secrets: Set<string>,
): void {
  const adapter = adapterId(config);
  if (
    ![
      "http-json-v1",
      "search-json-v1",
      "mcp-tool-v1",
      "module-tool-v1",
      "workspace-file-v1",
    ].includes(adapter ?? "")
  )
    return;
  requireToolSchemas(config);
  const permissions = config.permissions;
  const capabilities = input.capabilityRequirements;
  if (adapter === "workspace-file-v1") {
    const permission = ["list", "search", "read"].includes(String(config.operation)) ? "workspace.read" : ["write", "undo"].includes(String(config.operation)) ? "workspace.write" : config.operation === "check" ? "workspace.check" : undefined;
    if (!permission || input.scope !== "project" || !exactOne(permissions, permission) || !exactOne(capabilities, permission) || secrets.size > 0 || ["mcpResourceId", "toolName", "method", "networkMode", "moduleId", "exportId"].some((key) => Object.hasOwn(config, key))) invalidResource();
    return;
  }
  if (adapter === "http-json-v1" || adapter === "search-json-v1") {
    if (
      input.scope !== "user" ||
      !exactOne(permissions, "network.request") ||
      !exactOne(capabilities, "network.request") ||
      !hasSecret(secrets, "endpoint") ||
      (config.method !== "GET" && config.method !== "POST") ||
      (config.networkMode !== "remote" && config.networkMode !== "loopback") ||
      ["mcpResourceId", "toolName", "moduleId", "exportId"].some((key) =>
        Object.hasOwn(config, key),
      ) ||
      secrets.has("access")
    )
      invalidResource();
    return;
  }
  if (adapter === "mcp-tool-v1") {
    const serverId = config.mcpResourceId;
    if (
      input.scope !== "user" ||
      !validResourceId(serverId) ||
      typeof config.toolName !== "string" ||
      !config.toolName.trim() ||
      config.toolName.length > 128 ||
      /[\u0000-\u001f]/.test(config.toolName) ||
      !Array.isArray(permissions) ||
      permissions.length !== 1 ||
      !["mcp.local", "network.request"].includes(String(permissions[0])) ||
      !exactOne(capabilities, String(permissions[0])) ||
      ["moduleId", "exportId", "method", "networkMode"].some((key) =>
        Object.hasOwn(config, key),
      ) ||
      secrets.size > 0
    )
      invalidResource();
    return;
  }
  if (
    input.scope !== "project" ||
    !exactOne(permissions, "module.execute") ||
    !exactOne(capabilities, "module.execute") ||
    !validResourceId(config.moduleId) ||
    !validResourceId(config.exportId) ||
    ["mcpResourceId", "toolName", "method", "networkMode"].some((key) =>
      Object.hasOwn(config, key),
    ) ||
    secrets.size > 0
  )
    invalidResource();
}

function validateNewMcp(
  input: Record<string, any>,
  config: Record<string, unknown>,
  secrets: Set<string>,
): void {
  if (adapterId(config) !== "mcp-server-v1") return;
  if (
    input.scope !== "user" ||
    !Number.isInteger(config.timeoutMs) ||
    Number(config.timeoutMs) < 1 ||
    Number(config.timeoutMs) > 120000
  )
    invalidResource();
  if (config.transport === "stdio") {
    if (
      !exactOne(config.permissions, "mcp.local") ||
      !exactOne(input.capabilityRequirements, "mcp.local") ||
      !hasSecret(secrets, "launch") ||
      secrets.size !== 1 ||
      Object.hasOwn(config, "networkMode") ||
      Object.hasOwn(config, "endpoint")
    )
      invalidResource();
    return;
  }
  if (config.transport === "streamable-http") {
    if (
      !exactOne(config.permissions, "network.request") ||
      !exactOne(input.capabilityRequirements, "network.request") ||
      !hasSecret(secrets, "endpoint") ||
      (config.networkMode !== "remote" && config.networkMode !== "loopback") ||
      secrets.has("launch") ||
      Object.hasOwn(config, "endpoint") ||
      Array.from(secrets).some(
        (field) => !["endpoint", "headers"].includes(field),
      )
    )
      invalidResource();
    return;
  }
  invalidResource();
}

/** Validates untrusted input without executing implementations or resolving secrets. */
export function validateResource(input: unknown): Resource {
  if (!record(input)) invalidResource();
  const allowed = [
    "schemaVersion",
    "resourceId",
    "kind",
    "scope",
    "displayName",
    "definition",
    "capabilityRequirements",
    "secretBindings",
  ];
  if (
    Object.keys(input).length !== allowed.length ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    invalidResource();
  if (
    input.schemaVersion !== "blocky.resource/v1alpha1" ||
    !validResourceId(input.resourceId) ||
    !["project", "user"].includes(String(input.scope))
  )
    invalidResource();
  check(input.displayName, { type: "string" });
  check(input.capabilityRequirements, {
    type: "array",
    items: { type: "string", format: "id" },
  });
  const metadata = resourceDefinitions.find((item) => item.kind === input.kind);
  if (
    !metadata ||
    !record(input.definition) ||
    !Array.isArray(input.secretBindings)
  )
    invalidResource();
  const bound = new Set<string>();
  for (const binding of input.secretBindings) {
    if (
      !record(binding) ||
      Object.keys(binding).length !== 2 ||
      !Object.hasOwn(binding, "fieldId") ||
      !Object.hasOwn(binding, "secretRef") ||
      typeof binding.fieldId !== "string" ||
      !metadata.secretFields.includes(binding.fieldId) ||
      !validResourceId(binding.secretRef) ||
      bound.has(binding.fieldId)
    )
      invalidResource();
    if (/^(?:sk-|eyJ)/.test(binding.secretRef)) invalidResource();
    bound.add(binding.fieldId);
    if (Object.hasOwn(input.definition, binding.fieldId)) invalidResource();
  }
  const config = input.definition;
  if (config.connectionRef !== undefined) {
    if (input.kind !== "model" || input.scope !== "user" || !validResourceId(config.connectionRef)) invalidResource();
    if (config.connectionRevision === undefined) {
      if (input.secretBindings.length || Object.keys(config).some(k => !["connectionRef", "modelId", "timeoutMs", "capabilities", "parameters"].includes(k))) invalidResource();
      if (config.parameters !== undefined && (!record(config.parameters) || Object.keys(config.parameters).some(k => !["temperature", "topP", "maxOutputTokens"].includes(k)))) invalidResource();
      check({ ...config, provider: "deepseek", protocol: "openai-chat", implementationRef: { kind: "adapter", id: "deepseek-v1" } }, metadata.definitionSchema);
      return structuredClone(input) as Resource;
    }
  }
  // Exact stage-one adapters remain wire compatible; other implementations use typed refs.
  const legacy =
    (input.kind === "model" &&
      config.implementationRef === "adapter://deterministic/composer-v1") ||
    (input.kind === "knowledge" &&
      config.implementationRef === "adapter://deterministic/knowledge-v1");
  if (legacy) {
    const legacyFields =
      input.kind === "model"
        ? ["implementationRef"]
        : ["implementationRef", "collection"];
    if (Object.keys(config).some((key) => !legacyFields.includes(key)))
      invalidResource();
    const { implementationRef: _implementationRef, ...rest } = config;
    check(rest, { ...metadata.definitionSchema, required: [] });
    if (input.kind === "knowledge" && !validResourceId(config.collection))
      invalidResource();
  } else {
    check(config, metadata.definitionSchema);
    const builtinModel =
      input.kind === "model" &&
      record(config.implementationRef) &&
      config.implementationRef.kind === "adapter" &&
      ((config.implementationRef.id === "generator-v1" &&
        config.provider === "deterministic" &&
        config.protocol === "local") ||
        (config.implementationRef.id === "local-score-v1" &&
          config.provider === "local-cpu" && config.protocol === "local" &&
          config.modelId === "ms-marco-minilm-l6-v2-int8-v1" &&
          exactOne(config.capabilities,"rerank") && input.secretBindings.length===0 && !config.baseUrl) ||
        (config.implementationRef.id === "deepseek-v1" &&
          config.provider === "deepseek" &&
          config.protocol === "openai-chat") ||
        (config.implementationRef.id === "xirang-v1" &&
          config.provider === "xirang" &&
          config.protocol === "openai-chat") ||
        (config.implementationRef.id === "managed-local-v1" &&
          config.provider === "managed-local" &&
          config.protocol === "local" &&
          config.modelId === "qwen3-0.6b-q8-v1" &&
          input.scope === "user" &&
          input.secretBindings.length === 0));
    if (config.localRuntime && config.provider !== "managed-local")
      invalidResource();
    if (
      config.provider === "managed-local" &&
      (!builtinModel || config.baseUrl)
    )
      invalidResource();
    if (
      input.kind === "model" &&
      !builtinModel &&
      !config.baseUrl &&
      !bound.has("baseUrl")
    )
      invalidResource();
    if (
      input.kind === "knowledge" &&
      ((!config.sourceRef &&
        !(Array.isArray(config.sourceRefs) && config.sourceRefs.length)) ||
        !config.chunking ||
        !config.retrieval)
    )
      invalidResource();
  }
  if (
    record(config.chunking) &&
    Number(config.chunking.overlap) >= Number(config.chunking.size)
  )
    invalidResource();
  if (input.kind === "tool") validateNewTool(input, config, bound);
  if (input.kind === "mcp") validateNewMcp(input, config, bound);
  if (
    input.kind === "mcp" &&
    config.transport !== "stdio" &&
    !config.endpoint &&
    !bound.has("endpoint")
  )
    invalidResource();
  if (
    input.kind === "mcp" &&
    config.transport === "stdio" &&
    (config.endpoint || bound.has("endpoint"))
  )
    invalidResource();
  return structuredClone(input) as Resource;
}
