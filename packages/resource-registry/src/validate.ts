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
      value.length > 2048 ||
      /[\u0000-\u001f]/.test(value)
    )
      invalidResource();
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
