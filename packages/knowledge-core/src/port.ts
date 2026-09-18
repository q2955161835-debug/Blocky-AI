import type {
  KnowledgePort,
  SourcePage,
  SourceSummary,
  StoredIndex,
} from "./types";
import {writeKnowledgeState} from "./store-schema";
export type KnowledgeCall = (
  operation: string,
  fields: Record<string, unknown>,
) => Promise<unknown>;
/** Both clients speak this same protocol; only Host owns paths, grants and storage. */
export function knowledgePort(
  call: KnowledgeCall,
  projectId: string,
  collectionId: string,
): KnowledgePort {
  const invoke = (operation: string, fields: Record<string, unknown> = {}) =>
    call(operation, { projectId, collectionId, ...fields });
  return {
    sources: () =>
      invoke("knowledge-sources") as Promise<{
        generation: number;
        sources: SourceSummary[];
      }>,
    readSource: (sourceId, cursor, snapshotRevision) =>
      invoke("knowledge-read-source", {
        sourceId,
        ...(cursor === undefined ? {} : { cursor }),
        ...(snapshotRevision === undefined ? {} : { snapshotRevision }),
      }) as Promise<SourcePage>,
    load: () => invoke("knowledge-load-index") as Promise<StoredIndex>,
    save: (expectedRevision, expectedGeneration, value) =>
      invoke("knowledge-save-index", {
        expectedRevision,
        expectedGeneration,
        value: writeKnowledgeState(value),
      }) as Promise<{ revision: number; generation: number }>,
  };
}
