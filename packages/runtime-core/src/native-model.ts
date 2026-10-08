import { isUserOnlineModel } from "@blocky/resource-registry";
import type { Json } from "@blocky/language-schema";
import type { GenerationRequest } from "./agent-context";
import { modelOutputLimit } from "./agent-context";
import { integer } from "./budget";

/** Native resource resolution owns destinations and credentials. v1 remains a read-compatible adapter. */
export function nativeModelRequest(input: GenerationRequest) {
  const resource = input.resource,
    d = resource.definition;
  const legacy = ["deepseek", "xirang"].includes(String(d.provider));
  const v2 =
    input.reasoningEffort !== undefined ||
    d.connectionRef !== undefined ||
    input.maxOutputTokens > 1024 ||
    Number(d.timeoutMs) > 120000 ||
    !legacy ||
    (d.parameters !== undefined && d.parameters !== null && typeof d.parameters === "object" && !Array.isArray(d.parameters) && d.parameters.topP !== undefined) ||
    !!input.tools?.length ||
    input.outputSchema !== undefined ||
    input.messages.some((m) => m.role === "tool" || m.toolCalls?.length || m.imageRefs?.length);
  const binding = resource.secretBindings.find((b) => b.fieldId === "apiKey");
  if (
    resource.scope !== "user" ||
    d.protocol !== (d.provider === "managed-local" ? "local" : "openai-chat") ||
    typeof d.modelId !== "string" ||
    (v2 ? !isUserOnlineModel(resource) : !binding)
  )
    throw Error("BLK-PROVIDER-CONFIG");
  const p = d.parameters as Record<string, Json> | undefined;
  if (
    p &&
    Object.keys(p).some((k) => !["temperature", "topP", "maxOutputTokens"].includes(k))
  )
    throw Error("BLK-PROVIDER-CONFIG");
  const common = {
    requestId: input.requestId,
    projectId: input.projectId,
    resourceId: resource.resourceId,
    messages: input.messages,
    maxOutputTokens: modelOutputLimit(resource, input.maxOutputTokens),
    timeoutMs: integer(d.timeoutMs, 1, 3600000),
    ...(p?.temperature !== undefined ? { temperature: p.temperature } : {}),
  };
  if (v2)
    return {
      call: "provider-model-call",
      preflight: "provider-model-preflight",
      request: {
        schemaVersion: "blocky.model-request/v2",
        ...common,
        ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}),
        ...(p?.topP !== undefined ? { topP: p.topP } : {}),
        ...(input.tools?.length ? { tools: input.tools } : {}),
        ...(input.outputSchema !== undefined
          ? { outputSchema: input.outputSchema }
          : {}),
        ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
      },
    };
  return {
    call: "provider-call",
    preflight: "provider-preflight",
    request: {
      schemaVersion: "blocky.provider-request/v1",
      ...common,
      secretRef: binding!.secretRef,
      modelId: d.modelId,
      ...(d.provider === "xirang" ? { provider: "xirang" } : {}),
    },
  };
}
