import type { Chunk } from "./types";
export type ScoredChunk = { chunkId: string; score: number };
const stop = new Set(
  "a an the is are was were be of to in on at for and or with as by do does did what which how when where why can may should it its this that from".split(
    " ",
  ),
);
/** Fixed Unicode word/bigram tokenizer, independent of host locale dictionaries. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const run of text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{Script=Han}]+|[\p{Script=Latin}\p{N}_]+/gu) ?? []) {
    if (/^\p{Script=Han}/u.test(run)) {
      const points = Array.from(run);
      if (points.length === 1) out.push(run);
      else
        for (let i = 0; i < points.length - 1; i++)
          out.push(points[i] + points[i + 1]);
    } else if (!stop.has(run))
      out.push(run.length > 4 && run.endsWith("s") ? run.slice(0, -1) : run);
  }
  return out;
}
/** BM25 postings are built once per published version; ACL selection precedes scoring. */
export class KeywordIndex {
  private postings = new Map<string, Uint32Array>();
  private building = new Map<string, number[]>();
  private chunkIds: string[] = [];
  private lengths = new Map<string, number>();
  constructor(chunks: Chunk[]) {
    this.add(chunks);
    this.compact();
  }
  static async create(chunks: Chunk[], signal: AbortSignal) {
    const index = new KeywordIndex([]);
    for (let offset = 0; offset < chunks.length; offset += 128) {
      signal.throwIfAborted();
      index.add(chunks.slice(offset, offset + 128));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    index.compact();
    return index;
  }
  private add(chunks: Chunk[]) {
    for (const chunk of chunks) {
      const tokens = terms(`${chunk.title}\n${chunk.text}`);
      this.lengths.set(chunk.chunkId, tokens.length);
      const ordinal = this.chunkIds.length;
      this.chunkIds.push(chunk.chunkId);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      for (const [token, count] of frequencies) {
        let posting = this.building.get(token);
        if (!posting) {
          posting = [];
          this.building.set(token, posting);
        }
        posting.push(ordinal, count);
      }
    }
  }
  private compact() {
    for (const [term, pairs] of this.building) {
      this.postings.set(term, Uint32Array.from(pairs));
      this.building.delete(term);
    }
  }
  search(
    query: string,
    eligible: ReadonlySet<string>,
    limit: number,
  ): ScoredChunk[] {
    if (!eligible.size) return [];
    let totalLength = 0;
    for (const id of eligible) totalLength += this.lengths.get(id) ?? 0;
    const avg = Math.max(1, totalLength / eligible.size),
      scores = new Map<string, number>();
    for (const term of new Set(terms(query))) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      let frequency = 0;
      for (let i = 0; i < posting.length; i += 2)
        if (eligible.has(this.chunkIds[posting[i]]!)) frequency++;
      if (!frequency) continue;
      const idf = Math.log(
        1 + (eligible.size - frequency + 0.5) / (frequency + 0.5),
      );
      for (let i = 0; i < posting.length; i += 2) {
        const id = this.chunkIds[posting[i]]!,
          tf = posting[i + 1]!;
        if (!eligible.has(id)) continue;
        const score =
          (idf * tf * 2.2) /
          (tf + 1.2 * (0.25 + (0.75 * (this.lengths.get(id) ?? 0)) / avg));
        scores.set(id, (scores.get(id) ?? 0) + score);
      }
    }
    return [...scores]
      .map(([chunkId, score]) => ({ chunkId, score: score / (1 + score) }))
      .sort(rankOrder)
      .slice(0, limit);
  }
}
export function rankOrder(a: ScoredChunk, b: ScoredChunk) {
  return b.score - a.score || a.chunkId.localeCompare(b.chunkId, "en");
}
/** Reciprocal rank fusion avoids assuming BM25 and cosine have the same scale. */
export function fuseRanks(lists: ScoredChunk[][]): ScoredChunk[] {
  const scores = new Map<string, number>();
  for (const list of lists)
    list.forEach((hit, i) =>
      scores.set(
        hit.chunkId,
        (scores.get(hit.chunkId) ?? 0) + 1 / (60 + i + 1),
      ),
    );
  return [...scores]
    .map(([chunkId, score]) => ({
      chunkId,
      score: (score * 61) / lists.length,
    }))
    .sort(rankOrder);
}
