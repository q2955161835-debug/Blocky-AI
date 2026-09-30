import type { Resource } from "../../packages/language-schema/src";

export function modelResource(resourceId = "saved-model"): Resource {
  return {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId,
    kind: "model",
    scope: "user",
    displayName: "Saved online model",
    definition: {
      provider: "xirang",
      protocol: "openai-chat",
      modelId: "deepseek-v4-pro",
      timeoutMs: 60000,
      capabilities: ["text"],
      parameters: { maxOutputTokens: 512 },
      implementationRef: { kind: "adapter", id: "xirang-v1" },
    },
    capabilityRequirements: [],
    secretBindings: [{ fieldId: "apiKey", secretRef: "saved-model-secret" }],
  };
}
