import type { Resource } from "@blocky/language-schema";
/** No source text, index, local path, or credentials are serialized into a project. */
export function knowledgeResource(
  resourceId: string,
  displayName = "我的资料",
): Resource {
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
      index: { strategy: "keyword" },
      retrieval: { strategy: "keyword", topK: 5 },
    },
    capabilityRequirements: ["knowledge.read"],
    secretBindings: [],
  };
}
