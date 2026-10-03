import { expect, it } from "vitest";
import { renderAnswer, type Citation } from "../src/adapters";

const evidence: Citation = {
  id: "chunk-test",
  title: "算术函数",
  text: "export const add = (a, b) => a + b;",
  collectionId: "product-handbook",
  sourceId: "source-test",
  documentId: "document-test",
  revision: "a".repeat(64),
  digest: "b".repeat(64),
  locator: {
    path: "src/math.ts",
    lineStart: 3,
    lineEnd: 5,
    commit: "c".repeat(40),
  },
  score: 0.8,
  truncated: false,
};

it("does not invent or expose invalid source locations", () => {
  for (const locator of [
    undefined,
    { path: "/outside/private.ts", lineStart: 3, lineEnd: 5 },
    { path: "src/math.ts", lineStart: 0, lineEnd: 5 },
    { path: "src/math.ts", lineStart: 8, lineEnd: 5 },
  ]) {
    const answer = renderAnswer([{ ...evidence, locator }], "源码导览", "代码阅读");
    expect(answer).toContain("来源位置未提供，待核实");
    expect(answer).not.toContain("/outside/private.ts");
    expect(answer).toContain(evidence.text);
  }
});

it("keeps the existing cited-answer and empty-knowledge wording", () => {
  expect(
    renderAnswer([{ id: "old", title: "原有", text: "旧内容" }], "条目", "教师"),
  ).toBe(
    "学习要点\n\n• 旧内容 [原有]",
  );
  expect(renderAnswer([], "条目", "研究")).toBe("课程资料没有说明，待核实。");
});
