import type { Resource } from "@blocky/language-schema";
import { retrievalOptions } from "./retrieval";
export function resourceRetrieval(definition: Resource["definition"]) {
  const raw = definition.retrieval;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return retrievalOptions();
  const { rerankResourceId, filters, ...configuration } = raw;
  if (rerankResourceId) throw Error("BLK-KNOWLEDGE-RERANK");
  if (filters !== undefined && !Array.isArray(filters))
    throw Error("BLK-KNOWLEDGE-CONFIG");
  return retrievalOptions({
    ...configuration,
    filters: Object.fromEntries(
      (filters ?? []).map((f) => {
        if (
          !f ||
          typeof f !== "object" ||
          Array.isArray(f) ||
          typeof f.key !== "string" ||
          typeof f.value !== "string"
        )
          throw Error("BLK-KNOWLEDGE-CONFIG");
        return [f.key, f.value];
      }),
    ),
  });
}
/** No source text, index, local path, or credentials are serialized into a project. */
export function knowledgeResource(
  resourceId: string,
  displayName = "我的资料",
  retrieval: unknown = {},
): Resource {
  const options = retrievalOptions(retrieval);
  const { filters, ...settings } = options;
  return {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId,
    kind: "knowledge",
    scope: "project",
    displayName,
    definition: {
      collection: resourceId,
      implementationRef: { kind: "adapter", id: "knowledge-local-v1" },
      sourceRef: { kind: "resource", id: resourceId },
      chunking: { strategy: "paragraph", size: 768, overlap: 64 },
      index: { strategy: options.strategy },
      retrieval: {
        ...settings,
        filters: Object.entries(filters).map(([key, value]) => ({
          key,
          value,
        })),
      },
    },
    capabilityRequirements: ["knowledge.read"],
    secretBindings: [],
  };
}
