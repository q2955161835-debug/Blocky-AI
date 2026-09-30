import type { Resource } from "@blocky/language-schema";
import { implementationKey } from "./implementation";
import { validateResource } from "./validate";

export function isUserOnlineModel(resource: Resource): boolean {
  const definition = resource.definition;
  try {
    return (
      resource.kind === "model" &&
      resource.scope === "user" &&
      [
        "deepseek",
        "xirang",
        "openai-compatible",
        "ollama",
        "managed-local",
      ].includes(String(definition.provider)) &&
      definition.protocol ===
        (definition.provider === "managed-local" ? "local" : "openai-chat") &&
      Array.isArray(definition.capabilities) &&
      definition.capabilities.includes("text") &&
      implementationKey(definition.implementationRef) ===
        `adapter://${definition.provider}-v1` &&
      (definition.provider === "managed-local"
        ? resource.secretBindings.length === 0 &&
          definition.modelId === "qwen3-0.6b-q8-v1"
        : ["deepseek", "xirang"].includes(String(definition.provider))
          ? resource.secretBindings.length === 1 &&
            resource.secretBindings[0].fieldId === "apiKey"
          : resource.secretBindings.some(
              (binding) => binding.fieldId === "baseUrl",
            ) &&
            !definition.baseUrl &&
            resource.secretBindings.every((binding) =>
              ["baseUrl", "apiKey", "headers"].includes(binding.fieldId),
            ))
    );
  } catch {
    return false;
  }
}

/** A missing saved choice is actionable, never permission to select another provider. */
export function configuredOnlineModel(
  id: string,
  registry: ReadonlyMap<string, Resource>,
): Resource {
  const resource = registry.get(id);
  if (!resource || !isUserOnlineModel(resource))
    throw Error("BLK-MODEL-DEFAULT-001");
  return validateResource(resource);
}
