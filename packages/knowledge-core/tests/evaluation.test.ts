import { expect, it } from "vitest";
import { scoreKnowledgeQuality } from "../src/evaluation";
const cases = [
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `q${i}`,
    kind: "answer" as const,
    relevant: [`d${i}`],
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `n${i}`,
    kind: "no-answer" as const,
    relevant: [],
  })),
];
const rows = cases.map((item) => ({
  id: item.id,
  retrieved: item.relevant,
  status:
    item.kind === "answer" ? ("found" as const) : ("no-evidence" as const),
}));
it("requires eighteen source hits and nine actual insufficiency results on a complete frozen set", () => {
  const report = scoreKnowledgeQuality(cases, rows);
  expect(report).toMatchObject({
    answerHits: 20,
    noEvidence: 10,
    passed: true,
  });
  const missed = rows.map((row, i) =>
    i < 3 ? { ...row, retrieved: [] } : row,
  );
  expect(scoreKnowledgeQuality(cases, missed)).toMatchObject({
    answerHits: 17,
    passed: false,
  });
  const fabricated = rows.map((row, i) =>
    i >= 20
      ? {
          ...row,
          status: "found" as const,
          retrieved: ["unrelated"],
          clarification: true,
        }
      : row,
  );
  expect(scoreKnowledgeQuality(cases, fabricated)).toMatchObject({
    noEvidence: 0,
    passed: false,
  });
});
it("does not count missing, repeated or unexpected rows as a complete evaluation", () => {
  expect(scoreKnowledgeQuality(cases, rows.slice(1)).passed).toBe(false);
  expect(() => scoreKnowledgeQuality(cases, [...rows, rows[0]])).toThrow(
    "BLK-KNOWLEDGE-EVALUATION",
  );
  expect(() =>
    scoreKnowledgeQuality(cases, [
      ...rows,
      { id: "extra", retrieved: [], status: "no-evidence" },
    ]),
  ).toThrow("BLK-KNOWLEDGE-EVALUATION");
});
it("fails the entire frozen evaluation when any denied case returns evidence", () => {
  const denied = { id: "restricted", kind: "denied" as const, relevant: [] };
  const leakage = {
    id: denied.id,
    status: "found" as const,
    retrieved: ["private-document"],
  };
  expect(
    scoreKnowledgeQuality([...cases, denied], [...rows, leakage]),
  ).toMatchObject({ deniedFailures: [denied.id], passed: false });
  expect(
    scoreKnowledgeQuality(
      [...cases, denied],
      [...rows, { ...leakage, status: "no-evidence", retrieved: [] }],
    ).passed,
  ).toBe(true);
});
