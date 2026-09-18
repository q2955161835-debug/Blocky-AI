import { digest } from "@blocky/language-schema";
import { chunkDocument, parseDocument } from "./documents";
import { readKnowledgeState } from "./store-schema";
import type {
  KnowledgePort,
  KnowledgeState,
  KnowledgeIndex,
  SyncCounts,
  Chunk,
  DocumentRecord,
} from "./types";
export { readKnowledgeState } from "./store-schema";
const key = (sourceId: string, documentId: string) =>
  `${sourceId}/${documentId}`;
export async function synchronize(
  port: KnowledgePort,
  options: {
    signal?: AbortSignal;
    size?: number;
    overlap?: number;
    onProgress?: (counts: SyncCounts) => void;
  } = {},
): Promise<{ status: "completed" | "failed"; counts: SyncCounts }> {
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const chunking = {
    size: options.size ?? 768,
    overlap: options.overlap ?? 64,
  };
  if (
    !Number.isInteger(chunking.size) ||
    chunking.size < 1 ||
    chunking.size > 16000 ||
    !Number.isInteger(chunking.overlap) ||
    chunking.overlap < 0 ||
    chunking.overlap >= chunking.size
  )
    throw Error("BLK-KNOWLEDGE-BUDGET");
  const listed = await port.sources(),
    stored = await port.load();
  if (stored.generation !== listed.generation)
    throw Error("BLK-KNOWLEDGE-CONFLICT");
  let revision = stored.revision;
  const state = readKnowledgeState(stored.value);
  // Host generation revocation invalidates both published and staged data.
  if (state.index?.generation !== listed.generation) state.index = null;
  if (state.pending?.index.generation !== listed.generation)
    state.pending = null;
  const old = state.index;
  const counts: SyncCounts = {
    added: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    chunks: 0,
  };
  const index: KnowledgeIndex = {
    schemaVersion: "blocky.knowledge-index/v1",
    generation: listed.generation,
    sources: {},
    documents: [],
    chunks: [],
    chunking,
  };
  const previous = new Map(
    (old?.documents ?? []).map((d) => [key(d.sourceId, d.documentId), d]),
  );
  const reusable = new Map<
    string,
    { document: DocumentRecord; chunks: Chunk[] }
  >();
  for (const candidate of [old, state.pending?.index]) {
    if (
      !candidate ||
      candidate.chunking.size !== chunking.size ||
      candidate.chunking.overlap !== chunking.overlap
    )
      continue;
    const chunks = new Map(candidate.chunks.map((c) => [c.chunkId, c]));
    for (const document of candidate.documents)
      reusable.set(key(document.sourceId, document.documentId), {
        document,
        chunks: document.chunkIds.map((id) => chunks.get(id)!),
      });
  }
  const pending: NonNullable<KnowledgeState["pending"]> = {
    index,
    checkpoints: {},
    completedSources: [],
    failures: [],
    counts,
  };
  const save = async (value: KnowledgeState) => {
    signal.throwIfAborted();
    const saved = await port.save(revision, listed.generation, value);
    revision = saved.revision;
  };
  const seen = new Set<string>();
  for (const source of listed.sources) {
    signal.throwIfAborted();
    if (!source.readable) continue;
    const checkpoint = state.pending?.checkpoints[source.sourceId];
    const resume =
      checkpoint &&
      checkpoint.revision === source.revision &&
      state.pending?.index.chunking.size === chunking.size &&
      state.pending.index.chunking.overlap === chunking.overlap;
    const stagedDocuments: DocumentRecord[] = resume
        ? state.pending!.index.documents.filter(
            (d) => d.sourceId === source.sourceId,
          )
        : [],
      stagedChunks: Chunk[] = resume
        ? state.pending!.index.chunks.filter(
            (c) => c.sourceId === source.sourceId,
          )
        : [];
    const sourceCounts = { added: 0, updated: 0, skipped: 0 };
    const otherDocuments = index.documents.length,
      otherChunks = index.chunks.length;
    const countDocument = (document: DocumentRecord) => {
      const before = previous.get(key(document.sourceId, document.documentId));
      if (!before) sourceCounts.added++;
      else if (
        before.contentDigest === document.contentDigest &&
        old?.chunking.size === chunking.size &&
        old.chunking.overlap === chunking.overlap
      )
        sourceCounts.skipped++;
      else sourceCounts.updated++;
    };
    for (const document of stagedDocuments) {
      seen.add(key(document.sourceId, document.documentId));
      countDocument(document);
    }
    const stage = () => {
      index.documents = [
        ...index.documents.filter((d) => d.sourceId !== source.sourceId),
        ...stagedDocuments,
      ];
      index.chunks = [
        ...index.chunks.filter((c) => c.sourceId !== source.sourceId),
        ...stagedChunks,
      ];
    };
    try {
      let cursor = resume ? checkpoint.nextCursor : undefined,
        snapshotRevision = resume ? checkpoint.revision : undefined;
      if (resume) pending.checkpoints[source.sourceId] = checkpoint;
      while (cursor !== null) {
        signal.throwIfAborted();
        const page = await port.readSource(
          source.sourceId,
          cursor,
          snapshotRevision,
        );
        if (
          page.sourceId !== source.sourceId ||
          page.generation !== listed.generation ||
          (snapshotRevision !== undefined && page.revision !== snapshotRevision)
        )
          throw Error("BLK-KNOWLEDGE-CONFLICT");
        snapshotRevision = page.revision;
        for (const document of page.documents) {
          signal.throwIfAborted();
          const docKey = key(source.sourceId, document.documentId);
          if (seen.has(docKey)) throw Error("BLK-KNOWLEDGE-SOURCE");
          seen.add(docKey);
          // Include location/metadata for reparsing; chunk IDs themselves depend on content.
          const contentDigest = await digest(document),
            cached = reusable.get(docKey);
          const chunks =
            cached?.document.contentDigest === contentDigest
              ? cached.chunks
              : await chunkDocument(
                  source.sourceId,
                  parseDocument(document),
                  chunking,
                );
          const record = {
            sourceId: source.sourceId,
            documentId: document.documentId,
            revision: document.revision,
            contentDigest,
            chunkIds: chunks.map((c) => c.chunkId),
          };
          countDocument(record);
          stagedDocuments.push(record);
          stagedChunks.push(...chunks);
          if (
            otherDocuments + stagedDocuments.length > 100000 ||
            otherChunks + stagedChunks.length > 250000
          )
            throw Error("BLK-KNOWLEDGE-BUDGET");
        }
        if (
          page.nextCursor !== null &&
          (!Number.isSafeInteger(page.nextCursor) ||
            page.nextCursor <= (cursor ?? 0))
        )
          throw Error("BLK-KNOWLEDGE-SOURCE");
        cursor = page.nextCursor;
        pending.checkpoints[source.sourceId] = {
          revision: snapshotRevision,
          nextCursor: cursor,
        };
        index.sources[source.sourceId] = snapshotRevision;
        stage();
        await save({ ...state, pending });
        // Yield so a desktop Stop button can abort between bounded pages.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      index.sources[source.sourceId] = snapshotRevision!;
      stage();
      counts.added += sourceCounts.added;
      counts.updated += sourceCounts.updated;
      counts.skipped += sourceCounts.skipped;
      counts.chunks = index.chunks.length;
      pending.completedSources.push(source.sourceId);
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      if (error instanceof Error && error.message === "BLK-KNOWLEDGE-CONFLICT")
        throw error;
      pending.failures.push({
        sourceId: source.sourceId,
        code:
          error instanceof Error && /^BLK-KNOWLEDGE-[A-Z]+$/.test(error.message)
            ? error.message
            : "BLK-KNOWLEDGE-SOURCE",
      });
    }
    await save({ ...state, pending });
    options.onProgress?.({ ...counts });
  }
  if (pending.failures.length) {
    await save({ ...state, pending });
    return { status: "failed", counts };
  }
  counts.deleted = [...previous.keys()].filter((k) => !seen.has(k)).length;
  await save({
    schemaVersion: "blocky.knowledge-store/v1",
    index,
    pending: null,
  });
  return { status: "completed", counts };
}
