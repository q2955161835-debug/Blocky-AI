import { digest } from "@blocky/language-schema";
import { KeywordIndex, fuseRanks, type ScoredChunk } from "./keyword";
import {
  matchesMetadata,
  retrievalOptions,
  selectEvidence,
  type EvidenceCitation,
} from "./retrieval";
import { knowledgePort, type KnowledgeCall } from "./port";
import { readKnowledgeState } from "./store-schema";
import type { KnowledgeIndex, DocumentInput } from "./types";
import { parseDocument } from "./documents";
export const LOCAL_EMBEDDING_MODEL = "multilingual-e5-small-int8-v1";
type Head = {
  revision: number;
  generation: number;
  sources: { sourceId: string; readable: boolean }[];
};
type VectorReply = {
  modelId: string;
  indexRevision: number;
  generation: number;
  dimension: number;
  hits: ScoredChunk[];
  candidateCount: number;
  elapsedMs: number;
  modelSha256: string;
};
export type SearchResult = {
  status: "found" | "no-evidence";
  strategy: "keyword" | "vector" | "hybrid";
  citations: EvidenceCitation[];
  contextBytes: number;
  candidateCount: number;
  indexRevision: number;
  generation: number;
  elapsedMs: number;
  cacheHit: boolean;
  warning?: string;
  reranking?: {
    modelId: string;
    modelSha256: string;
    scoreMeaning: "sigmoid-logit-not-probability";
    externalApi: false;
  };
  embedding?: {
    modelId: string;
    dimension: number;
    modelSha256: string;
    externalApi: false;
  };
};
/** An instance belongs to one project/collection. Cache keys never grant permission. */
export class KnowledgeSearch {
  private cached?: {
    revision: number;
    generation: number;
    index: KnowledgeIndex;
    keyword: KeywordIndex;
    pending: boolean;
  };
  private port;
  constructor(
    private call: KnowledgeCall,
    readonly projectId: string,
    readonly collectionId: string,
  ) {
    this.port = knowledgePort(call, projectId, collectionId);
  }
  private invoke(op: string, fields: Record<string, unknown> = {}) {
    return this.call(op, {
      projectId: this.projectId,
      collectionId: this.collectionId,
      ...fields,
    });
  }
  async query(
    question: string,
    input: unknown = {},
    signal = new AbortController().signal,
  ): Promise<SearchResult> {
    const options = retrievalOptions(input),
      started = performance.now();
    if (typeof question !== "string" || question.length > 8000)
      throw Error("BLK-KNOWLEDGE-QUERY");
    signal.throwIfAborted();
    const head = (await this.invoke("knowledge-sources")) as Head;
    const cacheHit =
      !!this.cached &&
      this.cached.revision === head.revision &&
      this.cached.generation === head.generation;
    if (!cacheHit) {
      this.cached = undefined;
      // Keep only validated state across asynchronous keyword construction; the
      // unvalidated transport object can otherwise retain another whole index.
      const { revision, generation, state } = await this.port
        .load()
        .then((stored) => ({
          revision: stored.revision,
          generation: stored.generation,
          state: readKnowledgeState(stored.value),
        }));
      if (generation !== head.generation || revision !== head.revision)
        throw Error("BLK-KNOWLEDGE-CONFLICT");
      if (!state.index) throw Error("BLK-KNOWLEDGE-NO-INDEX");
      if (state.index.generation !== head.generation)
        throw Error("BLK-KNOWLEDGE-CONFLICT");
      const keyword = await KeywordIndex.create(state.index.chunks, signal);
      this.cached = {
        revision,
        generation,
        index: state.index,
        keyword,
        pending: !!state.pending,
      };
    }
    const cached = this.cached!,
      readable = new Set(
        head.sources.filter((s) => s.readable).map((s) => s.sourceId),
      );
    const chunks = cached.index.chunks.filter(
      (c) => readable.has(c.sourceId) && matchesMetadata(c, options.filters),
    );
    const eligible = new Set(chunks.map((c) => c.chunkId));
    let strategy = options.strategy,
      warning = cached.pending ? "BLK-KNOWLEDGE-PENDING" : undefined,
      embedding: SearchResult["embedding"],
      reranking: SearchResult["reranking"],
      ranked: ScoredChunk[] = [];
    const abort = () => {
      void this.invoke("knowledge-cancel").catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (question.trim() && eligible.size) {
        const keyword = () =>
          cached.keyword.search(question, eligible, options.maxCandidates);
        if (strategy === "keyword") ranked = keyword();
        else {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const reply = await Promise.race([
              this.invoke("knowledge-vector-query", {
                query: question,
                eligibleChunkIds: [...eligible],
                topK: options.maxCandidates,
                expectedRevision: head.revision,
                expectedGeneration: head.generation,
                modelId: options.modelId,
              }) as Promise<VectorReply>,
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                  abort();
                  reject(Error("BLK-KNOWLEDGE-TIMEOUT"));
                }, options.timeoutMs);
              }),
            ]);
            if (
              reply.indexRevision !== head.revision ||
              reply.generation !== head.generation
            )
              throw Error("BLK-KNOWLEDGE-CONFLICT");
            if (
              reply.modelId !== options.modelId ||
              reply.dimension < 1 ||
              reply.hits.some(
                (h) => !eligible.has(h.chunkId) || !Number.isFinite(h.score),
              )
            )
              throw Error("BLK-KNOWLEDGE-VECTOR");
            embedding = {
              modelId: reply.modelId,
              dimension: reply.dimension,
              modelSha256: reply.modelSha256,
              externalApi: false,
            };
            ranked =
              strategy === "hybrid"
                ? fuseRanks([keyword(), reply.hits])
                : reply.hits;
          } catch (error) {
            if (signal.aborted) signal.throwIfAborted();
            if (
              options.fallback !== "keyword" ||
              (error instanceof Error &&
                error.message === "BLK-KNOWLEDGE-CONFLICT")
            )
              throw error;
            strategy = "keyword";
            warning = "BLK-KNOWLEDGE-KEYWORD-FALLBACK";
            ranked = keyword();
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      }
      if (options.rerank && options.rerankModelId && ranked.length) {
        signal.throwIfAborted();
        const candidateIds = ranked.map((hit) => hit.chunkId);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let reply: VectorReply;
        try {
          reply = await Promise.race([
            this.invoke("knowledge-rerank", {
              modelId: options.rerankModelId,
              query: question,
              chunkIds: candidateIds,
              expectedRevision: head.revision,
              expectedGeneration: head.generation,
            }) as Promise<VectorReply>,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                abort();
                reject(Error("BLK-KNOWLEDGE-TIMEOUT"));
              }, options.timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (
          reply.indexRevision !== head.revision ||
          reply.generation !== head.generation
        )
          throw Error("BLK-KNOWLEDGE-CONFLICT");
        if (
          reply.modelId !== options.rerankModelId ||
          reply.hits.length !== candidateIds.length ||
          new Set(reply.hits.map((h) => h.chunkId)).size !==
            candidateIds.length ||
          reply.hits.some(
            (h) =>
              !candidateIds.includes(h.chunkId) || !Number.isFinite(h.score),
          )
        )
          throw Error("BLK-KNOWLEDGE-RERANK");
        ranked = reply.hits.map((hit) => ({
          ...hit,
          score: 1 / (1 + Math.exp(-hit.score)),
        }));
        reranking = {
          modelId: reply.modelId,
          modelSha256: reply.modelSha256,
          scoreMeaning: "sigmoid-logit-not-probability",
          externalApi: false,
        };
      }
      const selected = selectEvidence(
        question,
        chunks,
        ranked,
        reranking ? { ...options, rerank: false } : options,
      );
      for (const citation of selected.citations) {
        const chunk = chunks.find((c) => c.chunkId === citation.id)!;
        if ((await digest(chunk.text)) !== chunk.digest)
          throw Error("BLK-KNOWLEDGE-CORRUPT");
      }
      signal.throwIfAborted();
      // An ACL change during inference invalidates results before they reach callers.
      const after = (await this.invoke("knowledge-sources")) as Head;
      if (
        after.revision !== head.revision ||
        after.generation !== head.generation
      ) {
        this.cached = undefined;
        throw Error("BLK-KNOWLEDGE-CONFLICT");
      }
      return {
        status: selected.citations.length ? "found" : "no-evidence",
        strategy,
        citations: selected.citations.map((c) => ({
          ...c,
          collectionId: this.collectionId,
        })),
        contextBytes: selected.contextBytes,
        candidateCount: ranked.length,
        indexRevision: head.revision,
        generation: head.generation,
        elapsedMs: performance.now() - started,
        cacheHit,
        ...(warning ? { warning } : {}),
        ...(embedding ? { embedding } : {}),
        ...(reranking ? { reranking } : {}),
      };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async openCitation(citation: EvidenceCitation): Promise<DocumentInput> {
    const raw = (await this.invoke("knowledge-read-document", {
      sourceId: citation.sourceId,
      documentId: citation.documentId,
      revision: citation.revision,
    })) as DocumentInput;
    const parsed = parseDocument(raw);
    const text = parsed.lines
      .filter(
        (l) =>
          l.line >= citation.locator.lineStart &&
          l.line <= citation.locator.lineEnd,
      )
      .map((l) => l.text)
      .join("\n");
    if (
      raw.revision !== citation.revision ||
      raw.documentId !== citation.documentId ||
      raw.locator.path !== citation.locator.path ||
      raw.locator.url !== citation.locator.url ||
      raw.locator.commit !== citation.locator.commit ||
      ["page", "paragraph", "sheet", "cellRange", "row", "region"].some(
        (key) =>
          JSON.stringify(raw.locator[key as keyof typeof raw.locator]) !==
          JSON.stringify(
            citation.locator[key as keyof typeof citation.locator],
          ),
      ) ||
      !citation.text ||
      !text.includes(citation.text)
    )
      throw Error("BLK-KNOWLEDGE-CITATION");
    return raw;
  }
  async embed(modelId = LOCAL_EMBEDDING_MODEL) {
    const head = (await this.invoke("knowledge-sources")) as Head;
    return this.invoke("knowledge-embed-index", {
      modelId,
      expectedRevision: head.revision,
      expectedGeneration: head.generation,
    });
  }
}
