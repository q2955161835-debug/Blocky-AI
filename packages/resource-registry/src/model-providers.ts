import { canonicalJson, type Resource } from "@blocky/language-schema";
import { invalidResource, validResourceId, validateResource } from "./validate";
import type { UserRegistry } from "./user-registry";
export const providerAdapters = ["deepseek", "xirang", "openai-compatible", "ollama"] as const;
export type ModelProvider = {
  schemaVersion: "blocky.model-provider/v1"; providerId: string; displayName: string;
  adapter: typeof providerAdapters[number]; protocol: "openai-chat"; revision: number;
  secretBindings: Resource["secretBindings"];
};
const resolvedConnections = new WeakSet<Resource>();
export const isResolvedConnection = (resource: Resource): boolean => resolvedConnections.has(resource);
export function parseModelProvider(value: unknown): ModelProvider {
  const p = value as ModelProvider;
  if (!p || typeof p !== "object" || Array.isArray(p) ||
    Object.keys(p).length !== 7 || Object.keys(p).some(k => !["schemaVersion", "providerId", "displayName", "adapter", "protocol", "revision", "secretBindings"].includes(k)) ||
    p.schemaVersion !== "blocky.model-provider/v1" || !validResourceId(p.providerId) ||
    !providerAdapters.includes(p.adapter) || p.protocol !== "openai-chat" ||
    !Number.isInteger(p.revision) || p.revision < 1 || p.revision > 2147483647 || !Array.isArray(p.secretBindings)) invalidResource();
  // Reuse the credential/name and adapter validator without handling credential values.
  validateResource({ schemaVersion: "blocky.resource/v1alpha1", resourceId: p.providerId,
    kind: "model", scope: "user", displayName: p.displayName, capabilityRequirements: [],
    definition: { provider: p.adapter, protocol: p.protocol, modelId: "validation-model", timeoutMs: 60000,
      capabilities: ["text"], implementationRef: { kind: "adapter", id: `${p.adapter}-v1` } },
    secretBindings: p.secretBindings });
  const fields = p.secretBindings.map(b => b.fieldId);
  if (p.secretBindings.some(b => !["baseUrl", "apiKey", "headers"].includes(b.fieldId)) ||
    (/^(deepseek|xirang)$/.test(p.adapter) ? fields.length !== 1 || fields[0] !== "apiKey" : !fields.includes("baseUrl"))) invalidResource();
  return structuredClone(p);
}
export function resolveRegistryResources(registry: UserRegistry): Map<string, Resource> {
  const providers = new Map(registry.providers.map(p => [p.providerId, parseModelProvider(p)]));
  return new Map(registry.resources.map(raw => {
    const ref = raw.definition.connectionRef;
    if (ref === undefined) return [raw.resourceId, validateResource(raw)];
    const p = providers.get(String(ref));
    if (!p || raw.kind !== "model" || raw.scope !== "user" || raw.secretBindings.length || raw.definition.connectionRevision !== undefined) invalidResource();
    const resolved = validateResource({ ...raw, definition: { ...raw.definition,
      provider: p.adapter, protocol: p.protocol, implementationRef: { kind: "adapter", id: `${p.adapter}-v1` },
      connectionRevision: p.revision }, secretBindings: p.secretBindings });
    resolvedConnections.add(resolved);
    return [raw.resourceId, resolved];
  }));
}
export function migrateModelProviders(resources: Resource[]): { providers: ModelProvider[]; resources: Resource[] } {
  const providers: ModelProvider[] = [], byConnection = new Map<string, ModelProvider>();
  const migrated = resources.map(r => {
    const d = r.definition;
    if (r.kind !== "model" || !providerAdapters.includes(d.provider as ModelProvider["adapter"]) || d.protocol !== "openai-chat" ||
      d.baseUrl !== undefined || canonicalJson(d.implementationRef) !== canonicalJson({ kind: "adapter", id: `${d.provider}-v1` })) return r;
    let candidate: ModelProvider;
    try { candidate = parseModelProvider({ schemaVersion: "blocky.model-provider/v1", providerId: `provider-${r.resourceId}`,
      displayName: String(d.provider), adapter: d.provider, protocol: d.protocol, revision: 1, secretBindings: r.secretBindings }); }
    catch { return r; }
    const key = canonicalJson({ adapter: candidate.adapter, protocol: candidate.protocol,
      bindings: [...candidate.secretBindings].sort((a,b) => a.fieldId.localeCompare(b.fieldId)) });
    let p = byConnection.get(key);
    if (!p) { p = candidate; byConnection.set(key, p); providers.push(p); }
    const { provider: _provider, protocol: _protocol, implementationRef: _impl, ...model } = d;
    return { ...r, definition: { ...model, connectionRef: p.providerId }, secretBindings: [] };
  });
  return { providers, resources: migrated };
}
export function upsertModelProvider(registry: UserRegistry, value: unknown): UserRegistry {
  const p = parseModelProvider(value), old = registry.providers.find(x => x.providerId === p.providerId);
  if (old && p.revision !== old.revision) throw Error("BLK-RESOURCE-CONFLICT");
  const next = { ...registry, revision: registry.revision + 1, providers: [...registry.providers.filter(x => x.providerId !== p.providerId),
    { ...p, revision: old ? old.revision + 1 : 1 }] };
  if (next.providers.length > 256 || next.revision > 2147483647) invalidResource();
  resolveRegistryResources(next);
  return next;
}
export function removeModelProvider(registry: UserRegistry, id: string): UserRegistry {
  if (!validResourceId(id) || !registry.providers.some(p => p.providerId === id)) invalidResource();
  if (registry.resources.some(r => r.definition.connectionRef === id)) throw Error("BLK-PROVIDER-IN-USE");
  return { ...registry, revision: registry.revision + 1, providers: registry.providers.filter(p => p.providerId !== id) };
}
