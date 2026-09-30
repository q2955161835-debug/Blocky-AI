import type { Resource } from "@blocky/language-schema";
import { implementationKey } from "./implementation";
import { validateResource } from "./validate";

export function isUserOnlineModel(resource: Resource): boolean {
  const definition = resource.definition;
  try {
    return resource.kind === "model" && resource.scope === "user" &&
    ["deepseek", "xirang"].includes(String(definition.provider)) &&
    definition.protocol === "openai-chat" &&
    Array.isArray(definition.capabilities) && definition.capabilities.includes("text") &&
    implementationKey(definition.implementationRef) === `adapter://${definition.provider}-v1` &&
    resource.secretBindings.length === 1 && resource.secretBindings[0].fieldId === "apiKey";
  } catch { return false; }
}

/** A missing saved choice is actionable, never permission to select another provider. */
export function configuredOnlineModel(id: string, registry: ReadonlyMap<string, Resource>): Resource {
  const resource = registry.get(id);
  if (!resource || !isUserOnlineModel(resource)) throw Error("BLK-MODEL-DEFAULT-001");
  return validateResource(resource);
}
