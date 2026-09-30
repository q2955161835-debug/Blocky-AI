import { expect, it } from "vitest";
import { nativeAgentServices } from "../src/native-agent";
import { checkGenerationMetadata, type Generation } from "../src/agent-context";
import {
  configuredOnlineModel,
  validateResource,
} from "@blocky/resource-registry";
import type { Resource } from "@blocky/language-schema";

const resource = (provider = "ollama"): Resource => ({
  schemaVersion: "blocky.resource/v1alpha1",
  resourceId: "my-model",
  kind: "model",
  scope: "user",
  displayName: "Model",
  capabilityRequirements: [],
  secretBindings: [{ fieldId: "baseUrl", secretRef: "endpoint-ref" }],
  definition: {
    provider,
    protocol: "openai-chat",
    modelId: "qwen3:small",
    timeoutMs: 30000,
    capabilities: ["text", "tools"],
    implementationRef: { kind: "adapter", id: `${provider}-v1` },
  },
});
const result: Generation = {
  text: "response",
  model: "qwen3:small",
  requestId: "response1",
  provider: "ollama",
  transport: "local",
  usage: null,
};

it("configures a referenced local service as default without serializing its endpoint", () => {
  const r = resource();
  expect(
    configuredOnlineModel(r.resourceId, new Map([[r.resourceId, r]])),
  ).toEqual(r);
  expect(validateResource(r)).toEqual(r);
  expect(() =>
    validateResource({
      ...r,
      definition: { ...r.definition, baseUrl: "http://127.0.0.1:11434" },
      secretBindings: [],
    }),
  ).toThrow();
});
it("routes custom and local generation through a reference-only Host request", async () => {
  for (const provider of ["ollama", "openai-compatible"]) {
    const observed: { operation: string; fields: Record<string, unknown> }[] =
      [];
    const services = nativeAgentServices(async (operation, fields) => {
      observed.push({ operation, fields });
      return result;
    });
    await expect(
      services.generate!(
        {
          resource: resource(provider),
          projectId: "p",
          requestId: "r",
          messages: [{ role: "user", content: "public input" }],
          maxOutputTokens: 100,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual(result);
    expect(observed[0].operation).toBe("provider-model-call");
    expect(observed[0].fields.request).toEqual({
      schemaVersion: "blocky.model-request/v2",
      projectId: "p",
      resourceId: "my-model",
      requestId: "r",
      messages: [{ role: "user", content: "public input" }],
      maxOutputTokens: 100,
      timeoutMs: 30000,
    });
  }
});
it("accepts explicitly unavailable v2 usage and rejects missing or fabricated usage", () => {
  expect(() =>
    checkGenerationMetadata({
      ...result,
      transport: "remote",
      schemaVersion: "blocky.model-response/v2",
      usageStatus: "unavailable",
    }),
  ).not.toThrow();
  expect(() =>
    checkGenerationMetadata({ ...result, transport: "remote" }),
  ).toThrow("BLK-MODEL-003");
  expect(() =>
    checkGenerationMetadata({
      ...result,
      transport: "remote",
      schemaVersion: "blocky.model-response/v2",
      usageStatus: "reported",
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 6 },
    }),
  ).toThrow("BLK-MODEL-003");
});
