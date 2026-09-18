import { expect, it } from "vitest";
import { jsonFrame } from "../../tools/blocky-cli/src/json-frame";
it("streams large index records with JSON-compatible escaping and bounded batches", () => {
  const value = {
    schemaVersion: "test",
    omitted: undefined,
    index: {
      chunks: Array.from({ length: 10000 }, (_, n) => ({
        id: n,
        text: '资料\n"\\'.repeat(100),
        locator: { line: 1 },
        missing: undefined,
      })),
      pending: null,
    },
    values: [undefined, true, 1.5],
  };
  const frames = [...jsonFrame(value)];
  expect(frames.length).toBeGreaterThan(10);
  expect(frames.every((part) => part.length < 128 * 1024)).toBe(true);
  expect(frames.join("")).toBe(JSON.stringify(value) + "\n");
});
