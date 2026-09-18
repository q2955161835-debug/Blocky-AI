import { expect, it } from "vitest";
import { synchronize, readKnowledgeState } from "../src/sync";
import type {
  KnowledgePort,
  KnowledgeState,
  DocumentInput,
  SourcePage,
} from "../src/types";
const doc = (id: string, text: string): DocumentInput => ({
  documentId: id,
  title: id,
  format: "text",
  text,
  revision: text,
  locator: { path: `${id}.txt`, lineStart: 1, lineEnd: 1 },
  metadata: {},
});
class Store implements KnowledgePort {
  revision = 0;
  generation = 1;
  value: unknown = null;
  docs = new Map([
    [
      "source-a",
      [doc("one", "Water evaporation."), doc("two", "Rain comes from clouds.")],
    ],
  ]);
  denied = new Set<string>();
  broken = new Set<string>();
  async sources() {
    return {
      generation: this.generation,
      sources: [...this.docs.keys()].map((sourceId) => ({
        sourceId,
        kind: "file",
        title: sourceId,
        revision: "",
        readable: !this.denied.has(sourceId),
        allowedPrincipals: this.denied.has(sourceId) ? [] : ["local-user"],
        metadata: {},
      })),
    };
  }
  async readSource(sourceId: string): Promise<SourcePage> {
    if (this.broken.has(sourceId))
      throw Error("read failure with private path");
    return {
      sourceId,
      documents: this.docs.get(sourceId)!,
      revision: JSON.stringify(this.docs.get(sourceId)),
      excluded: [],
      nextCursor: null,
      generation: this.generation,
    };
  }
  async load() {
    return {
      revision: this.revision,
      generation: this.generation,
      value: structuredClone(this.value),
    };
  }
  async save(
    expectedRevision: number,
    expectedGeneration: number,
    value: KnowledgeState,
  ) {
    if (
      expectedRevision !== this.revision ||
      expectedGeneration !== this.generation
    )
      throw Error("BLK-KNOWLEDGE-CONFLICT");
    this.value = structuredClone(value);
    return { revision: ++this.revision, generation: this.generation };
  }
}
it("publishes real documents, skips unchanged records, and deletes removed documents", async () => {
  const port = new Store();
  expect((await synchronize(port)).counts).toMatchObject({
    added: 2,
    updated: 0,
    deleted: 0,
    skipped: 0,
  });
  const first = readKnowledgeState((await port.load()).value).index!;
  expect((await synchronize(port)).counts).toMatchObject({
    added: 0,
    updated: 0,
    deleted: 0,
    skipped: 2,
  });
  port.docs.set("source-a", [doc("one", "Water evaporation changes.")]);
  expect((await synchronize(port)).counts).toMatchObject({
    added: 0,
    updated: 1,
    deleted: 1,
    skipped: 0,
  });
  const next = readKnowledgeState((await port.load()).value).index!;
  expect(next.chunks.map((c) => c.text)).toEqual([
    "Water evaporation changes.",
  ]);
  expect(next.chunks[0].chunkId).not.toBe(first.chunks[0].chunkId);
});
it("does not publish a partial update and resumes stored parsing work", async () => {
  const port = new Store();
  await synchronize(port);
  port.docs.set("source-b", [doc("three", "New source")]);
  port.broken.add("source-b");
  const failed = await synchronize(port);
  expect(failed.status).toBe("failed");
  expect(readKnowledgeState(port.value).index!.chunks).toHaveLength(2);
  expect(readKnowledgeState(port.value).pending?.failures).toEqual([
    { sourceId: "source-b", code: "BLK-KNOWLEDGE-SOURCE" },
  ]);
  port.broken.clear();
  expect((await synchronize(port)).status).toBe("completed");
  expect(readKnowledgeState(port.value).index!.chunks).toHaveLength(3);
  expect(readKnowledgeState(port.value).pending).toBeNull();
});
it("removes denied sources and refuses stale-generation publication", async () => {
  const port = new Store();
  await synchronize(port);
  port.denied.add("source-a");
  port.generation++;
  await synchronize(port);
  expect(readKnowledgeState(port.value).index!.chunks).toEqual([]);
  port.denied.clear();
  const read = port.readSource.bind(port);
  port.readSource = async (id) => {
    const page = await read(id);
    port.generation++;
    return page;
  };
  await expect(synchronize(port)).rejects.toThrow("BLK-KNOWLEDGE-CONFLICT");
});
it("honors cancellation before writing and rejects corrupt persisted state", async () => {
  const port = new Store();
  const abort = new AbortController();
  abort.abort();
  await expect(synchronize(port, { signal: abort.signal })).rejects.toThrow();
  expect(port.value).toBeNull();
  expect(() =>
    readKnowledgeState({
      schemaVersion: "blocky.knowledge-store/v1",
      index: { chunks: "bad" },
      pending: null,
    }),
  ).toThrow("BLK-KNOWLEDGE-STORE");
});
it("keeps a resumable checkpoint between pages without publishing partial source content", async () => {
  const port = new Store(),
    abort = new AbortController();
  port.readSource = async () => ({
    sourceId: "source-a",
    documents: [doc("one", "First page.")],
    revision: "snapshot",
    excluded: [],
    nextCursor: 1,
    generation: 1,
  });
  const save = port.save.bind(port);
  port.save = async (r, g, value) => {
    const result = await save(r, g, value);
    abort.abort();
    return result;
  };
  await expect(synchronize(port, { signal: abort.signal })).rejects.toThrow();
  const state = readKnowledgeState(port.value);
  expect(state.index).toBeNull();
  expect(state.pending?.index.chunks[0].text).toBe("First page.");
  port.save = save;
  const calls: (number | undefined)[] = [];
  const sources = port.sources.bind(port);
  port.sources = async () => {
    const result = await sources();
    result.sources[0].revision = "snapshot";
    return result;
  };
  port.readSource = async (_id: string, cursor?: number, revision?: string) => {
    calls.push(cursor);
    expect(revision).toBe("snapshot");
    return {
      sourceId: "source-a",
      documents: [doc("two", "Second page.")],
      revision: "snapshot",
      excluded: [],
      nextCursor: null,
      generation: 1,
    };
  };
  expect((await synchronize(port)).status).toBe("completed");
  expect(calls).toEqual([1]);
  expect(readKnowledgeState(port.value).index?.documents).toHaveLength(2);
});

it("does not report published deletions when an existing source fails", async () => {
  const port = new Store();
  await synchronize(port);
  port.broken.add("source-a");
  const result = await synchronize(port);
  expect(result.status).toBe("failed");
  expect(result.counts.deleted).toBe(0);
  expect(readKnowledgeState(port.value).index?.documents).toHaveLength(2);
});
