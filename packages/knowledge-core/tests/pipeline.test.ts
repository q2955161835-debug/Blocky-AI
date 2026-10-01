import { expect, it } from "vitest";
import { knowledgeOperation } from "../src/pipeline";
import type { KnowledgeCall } from "../src/port";
const doc = {
  documentId: "d",
  title: "Water",
  text: "Water evaporates.",
  format: "text",
  revision: "v1",
  metadata: {},
  locator: { path: "water.txt", lineStart: 1, lineEnd: 1 },
};
function fixture() {
  let generation = 1;
  const writes: string[] = [];
  const call: KnowledgeCall = async (op) => {
    if (op === "knowledge-sources")
      return {
        generation,
        sources: [
          {
            sourceId: "s",
            kind: "file",
            title: "Water",
            revision: "v1",
            readable: true,
            allowedPrincipals: ["local-user"],
            metadata: {},
          },
        ],
      };
    if (op === "knowledge-read-source")
      return {
        sourceId: "s",
        revision: "v1",
        generation,
        documents: [doc],
        excluded: [],
        nextCursor: null,
      };
    writes.push(op);
    throw Error(op);
  };
  return {
    call,
    writes,
    revoke() {
      generation++;
    },
  };
}
it("previews real parsing and splitting without publishing or exposing source paths", async () => {
  const f = fixture();
  const result = await knowledgeOperation(f.call, "p", "c", "chunk", {
    size: 12,
    overlap: 0,
  });
  expect(result).toMatchObject({
    stage: "chunk",
    preview: true,
    samples: expect.arrayContaining([
      {
        chunkId: expect.any(String),
        documentId: "d",
        locator: { path: "water.txt", lineStart: 1, lineEnd: 1 },
        text: expect.any(String),
      },
    ]),
  });
  expect(f.writes).toEqual([]);
});
it("discards previews after permission changes during parsing", async () => {
  const f = fixture();
  const call: KnowledgeCall = async (op, fields) => {
    const value = await f.call(op, fields);
    if (op === "knowledge-read-source") f.revoke();
    return value;
  };
  await expect(knowledgeOperation(call, "p", "c", "parse")).rejects.toThrow(
    "BLK-KNOWLEDGE-CONFLICT",
  );
});
it("stops before any new reads when cancelled and rejects invalid chunk configuration", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await expect(
    knowledgeOperation(
      async () => {
        calls++;
      },
      "p",
      "c",
      "parse",
      {},
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(
    knowledgeOperation(fixture().call, "p", "c", "chunk", {
      size: 4,
      overlap: 4,
    }),
  ).rejects.toThrow("BLK-KNOWLEDGE-BUDGET");
});

it("limits actual chunk work to twenty samples even for tiny windows on large documents", async () => {
  const f = fixture();
  const call: KnowledgeCall = async (op, fields) => {
    const value = await f.call(op, fields);
    if (op === "knowledge-read-source")
      return {
        ...(value as object),
        documents: [{ ...doc, text: "a".repeat(20000) }],
      };
    return value;
  };
  const result = await knowledgeOperation(call, "p", "c", "chunk", {
    size: 1,
    overlap: 0,
  });
  expect(result).toMatchObject({
    fragments: 20,
    samples: expect.arrayContaining([expect.objectContaining({ text: "a" })]),
  });
});
