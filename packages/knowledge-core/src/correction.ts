import { z } from "zod";
import { KnowledgeSearch, type SearchResult } from "./search";
import { retrievalOptions, type EvidenceCitation } from "./retrieval";
export const knowledgeJudgmentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }).strict(),
  z.object({ action: z.literal("clarify") }).strict(),
  z
    .object({
      action: z.literal("rewrite"),
      query: z.string().trim().min(1).max(8000),
    })
    .strict(),
]);
export type KnowledgeJudgmentInput = {
  originalQuestion: string;
  query: string;
  citations: EvidenceCitation[];
};
export type CorrectedSearchResult = SearchResult & {
  correction: {
    rewrites: number;
    judgments: number;
    reason: "accepted" | "clarify" | "exhausted";
  };
};
/** Model judgments are untrusted data. A rewrite cannot grant access or change the original user question. */
export async function correctedQuery(
  search: Pick<KnowledgeSearch, "query" | "assertCurrent">,
  question: string,
  options: unknown,
  judge: (
    input: KnowledgeJudgmentInput,
    signal: AbortSignal,
  ) => Promise<unknown>,
  maxRewrites = 1,
  signal = new AbortController().signal,
): Promise<CorrectedSearchResult> {
  if (!Number.isSafeInteger(maxRewrites) || maxRewrites < 0 || maxRewrites > 2)
    throw Error("BLK-KNOWLEDGE-BUDGET");
  const configuration = retrievalOptions(options),
    seen = new Set<string>([question.trim()]);
  let query = question,
    rewrites = 0,
    judgments = 0;
  for (;;) {
    signal.throwIfAborted();
    const result = await search.query(query, configuration, signal);
    const value = await judge(
      { originalQuestion: question, query, citations: result.citations },
      signal,
    );
    signal.throwIfAborted();
    judgments++;
    const parsed = knowledgeJudgmentSchema.safeParse(value);
    if (!parsed.success) throw Error("BLK-KNOWLEDGE-JUDGMENT");
    await search.assertCurrent(result, signal);
    const decision = parsed.data;
    if (decision.action === "accept" && result.citations.length)
      return {
        ...result,
        correction: { rewrites, judgments, reason: "accepted" },
      };
    if (
      decision.action !== "rewrite" ||
      rewrites >= maxRewrites ||
      seen.has(decision.query)
    )
      return {
        ...result,
        status: "no-evidence",
        citations: [],
        contextBytes: 0,
        correction: {
          rewrites,
          judgments,
          reason: decision.action === "clarify" ? "clarify" : "exhausted",
        },
      };
    query = decision.query;
    seen.add(query);
    rewrites++;
  }
}
