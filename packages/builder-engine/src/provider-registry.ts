import type { Resource } from "@blocky/language-schema";
import { parseRegistry, resolveRegistryResources, validateResource } from "@blocky/resource-registry";
/** v2 carries connection records; legacy IPC still accepts its Resource array. */
export function readBuilderRegistry(value: unknown): Map<string, Resource> {
  if (Array.isArray(value)) {
    if (value.length > 256) throw Error("BLK-BUILDER-WIRE");
    return new Map(value.map(raw => { const r=validateResource(raw);return [r.resourceId,r]; }));
  }
  return resolveRegistryResources(parseRegistry(value));
}
