import {
  KnowledgeSearch,
  resourceRetrieval,
  type KnowledgeCall,
} from "@blocky/knowledge-core";
import { localAdapters } from "./adapters";
/** Composition only: the supplied callback owns Host transport, never credentials. */
export function hostAdapters(call: KnowledgeCall) {
  const adapters = localAdapters(),
    searches = new Map<string, KnowledgeSearch>();
  adapters.knowledge.set(
    "adapter://knowledge-local-v1",
    async (question, collection, signal, context) => {
      const key = JSON.stringify([context.projectId, collection]);
      let search = searches.get(key);
      if (!search) {
        if (searches.size >= 4) searches.delete(searches.keys().next().value!);
        search = new KnowledgeSearch(call, context.projectId, collection);
        searches.set(key, search);
      }
      const raw = context.resource.definition.retrieval;
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw Error("BLK-RESOURCE-001");
      const result = await search.query(
        question,
        resourceRetrieval(context.resource.definition),
        signal,
      );
      return {
        citations: result.citations,
        summary: `${result.strategy === "keyword" ? "关键词" : result.strategy === "vector" ? "向量" : "混合"}检索 · ${result.candidateCount} 个候选 · ${result.contextBytes} 字节上下文${result.warning ? ` · ${result.warning}` : ""}`,
      };
    },
  );
  return adapters;
}
