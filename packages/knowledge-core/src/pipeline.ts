import { z } from "zod";
import { knowledgeStages, stableId, type Json } from "@blocky/language-schema";
import { chunkDocument, parseDocument } from "./documents";
import { knowledgePort, type KnowledgeCall } from "./port";
import { KnowledgeSearch, LOCAL_EMBEDDING_MODEL } from "./search";
import { synchronize } from "./sync";
export { knowledgeStages };
export type KnowledgeStage = (typeof knowledgeStages)[number];
export const ingestionOptionsSchema = z
  .object({
    size: z.number().int().min(1).max(16000).optional(),
    overlap: z.number().int().min(0).max(15999).optional(),
    modelId: z.enum([LOCAL_EMBEDDING_MODEL, "minilm-l6-v2-int8-v1"]).optional(),
  })
  .strict()
  .refine((value) => (value.overlap ?? 64) < (value.size ?? 768));
export type IngestionOptions = z.infer<typeof ingestionOptionsSchema>;
/** Preview reads are bounded and never publish. Sync owns atomic publication and resumable checkpoints. */
export async function knowledgeOperation(
  call: KnowledgeCall,
  projectId: string,
  collectionId: string,
  stage: KnowledgeStage,
  options: IngestionOptions = {},
  signal = new AbortController().signal,
): Promise<Json> {
  signal.throwIfAborted();
  if (
    !stableId.test(projectId) ||
    !stableId.test(collectionId) ||
    !knowledgeStages.includes(stage)
  )
    throw Error("BLK-KNOWLEDGE-CONFIG");
  if (!ingestionOptionsSchema.safeParse(options).success)
    throw Error("BLK-KNOWLEDGE-BUDGET");
  const size = options.size ?? 768,
    overlap = options.overlap ?? 64;
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 16000 ||
    !Number.isSafeInteger(overlap) ||
    overlap < 0 ||
    overlap >= size
  )
    throw Error("BLK-KNOWLEDGE-BUDGET");
  const invoke = (operation: string, fields: Record<string, unknown> = {}) =>
    call(operation, { projectId, collectionId, ...fields });
  const cancel = () => {
    void invoke("knowledge-cancel").catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const port = knowledgePort(call, projectId, collectionId);
    if (stage === "sync") {
      const result = await synchronize(port, { size, overlap, signal });
      signal.throwIfAborted();
      if (result.status !== "completed") throw Error("BLK-KNOWLEDGE-SOURCE");
      return { stage, status: result.status, counts: { ...result.counts } };
    }
    if (stage === "embed") {
      const modelId = options.modelId ?? LOCAL_EMBEDDING_MODEL;
      await invoke("knowledge-model-install", { modelId });
      signal.throwIfAborted();
      const result = (await new KnowledgeSearch(
        call,
        projectId,
        collectionId,
      ).embed(modelId)) as Json;
      signal.throwIfAborted();
      return { stage, modelId, result };
    }
    if (stage === "index") {
      const result = (await invoke("knowledge-embedding-status")) as Json;
      signal.throwIfAborted();
      return { stage, result };
    }
    const head = await port.sources();
    signal.throwIfAborted();
    const readable = head.sources.filter((source) => source.readable);
    if (stage === "source")
      return {
        stage,
        sourceCount: readable.length,
        sources: readable
          .slice(0, 20)
          .map((source) => ({
            sourceId: source.sourceId,
            kind: source.kind,
            title: source.title,
          })),
      };
    const samples: Json[] = [];
    let documents = 0,
      fragments = 0;
    // Preview samples only: full ingestion remains in sync, with durable checkpoints.
    preview: for (const source of readable.slice(0, 3)) {
      signal.throwIfAborted();
      const page = await port.readSource(source.sourceId);
      if (
        page.sourceId !== source.sourceId ||
        page.generation !== head.generation
      )
        throw Error("BLK-KNOWLEDGE-CONFLICT");
      for (const document of page.documents.slice(0, 20)) {
        signal.throwIfAborted();
        documents++;
        const parsed = parseDocument(document);
        if (stage === "parse") {
          if (samples.length < 20)
            samples.push({
              documentId: document.documentId,
              sourceId: source.sourceId,
              text: parsed.lines
                .map((line) => line.text)
                .join("\n")
                .slice(0, 128),
              locator: document.locator as unknown as Json,
            });
        } else {
          const chunks = await chunkDocument(source.sourceId, parsed, {
            size,
            overlap,
            signal,
            maxChunks: 20 - samples.length,
          });
          fragments += chunks.length;
          for (const chunk of chunks)
            if (samples.length < 20)
              samples.push({
                chunkId: chunk.chunkId,
                documentId: chunk.documentId,
                text: chunk.text.slice(0, 128),
                locator: chunk.locator as unknown as Json,
              });
        }
        if (samples.length >= 20) break preview;
      }
    }
    signal.throwIfAborted();
    const after = await port.sources();
    if (
      after.generation !== head.generation ||
      JSON.stringify(after.sources) !== JSON.stringify(head.sources)
    )
      throw Error("BLK-KNOWLEDGE-CONFLICT");
    return {
      stage,
      preview: true,
      documents,
      fragments,
      samples,
      ...(stage === "chunk" ? { chunking: { size, overlap } } : {}),
    };
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
