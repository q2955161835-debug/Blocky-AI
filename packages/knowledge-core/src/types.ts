export type Locator = {
  path: string;
  lineStart: number;
  lineEnd: number;
  url?: string;
  commit?: string;
};
export type DocumentInput = {
  documentId: string;
  title: string;
  format: string;
  text: string;
  revision: string;
  locator: Locator;
  metadata: Record<string, string>;
};
export type ParsedDocument = Omit<DocumentInput, "text"> & {
  lines: { text: string; line: number }[];
};
export type Chunk = {
  chunkId: string;
  sourceId: string;
  documentId: string;
  title: string;
  text: string;
  digest: string;
  revision: string;
  locator: Locator;
  metadata: Record<string, string>;
  tokens: number;
};
export type SourceSummary = {
  sourceId: string;
  kind: string;
  title: string;
  revision: string;
  readable: boolean;
  allowedPrincipals: string[];
  metadata: Record<string, string>;
};
export type SourcePage = {
  sourceId: string;
  documents: DocumentInput[];
  revision: string;
  excluded: { path: string; reason: string }[];
  nextCursor: number | null;
  generation: number;
};
export type DocumentRecord = {
  sourceId: string;
  documentId: string;
  revision: string;
  contentDigest: string;
  chunkIds: string[];
};
export type KnowledgeIndex = {
  schemaVersion: "blocky.knowledge-index/v1";
  generation: number;
  sources: Record<string, string>;
  documents: DocumentRecord[];
  chunks: Chunk[];
  chunking: { size: number; overlap: number };
};
export type SyncCounts = {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  chunks: number;
};
export type PendingSync = {
  index: KnowledgeIndex;
  checkpoints: Record<string, { revision: string; nextCursor: number | null }>;
  completedSources: string[];
  failures: { sourceId: string; code: string }[];
  counts: SyncCounts;
};
export type KnowledgeState = {
  schemaVersion: "blocky.knowledge-store/v1";
  index: KnowledgeIndex | null;
  pending: PendingSync | null;
};
export type StoredIndex = {
  revision: number;
  generation: number;
  value: unknown;
};
/** Implementations derive permissions in Host, never from query-supplied principals. */
export interface KnowledgePort {
  sources(): Promise<{ generation: number; sources: SourceSummary[] }>;
  readSource(
    sourceId: string,
    cursor?: number,
    snapshotRevision?: string,
  ): Promise<SourcePage>;
  load(): Promise<StoredIndex>;
  save(
    expectedRevision: number,
    expectedGeneration: number,
    value: KnowledgeState,
  ): Promise<{ revision: number; generation: number }>;
}
