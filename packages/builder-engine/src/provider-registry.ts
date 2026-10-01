import type { Resource } from "@blocky/language-schema";
import { parseRegistry, resolveRegistryResources } from "@blocky/resource-registry";
/** v2 carries connection records; legacy IPC still accepts its Resource array. */
export function readBuilderRegistry(value: unknown): Map<string, Resource> {
  if (Array.isArray(value)) {
    if (value.length > 256) throw Error("BLK-BUILDER-WIRE");
    return resolveRegistryResources(parseRegistry({schemaVersion:"blocky.resource-registry/v1",resources:value}));
  }
  return resolveRegistryResources(parseRegistry(value));
}
