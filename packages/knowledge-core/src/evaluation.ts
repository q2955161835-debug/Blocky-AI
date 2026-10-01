export type QualityCase = {
  id: string;
  kind: "answer" | "no-answer" | "denied";
  relevant: string[];
};
export type QualityRow = {
  id: string;
  retrieved: string[];
  status: "found" | "no-evidence";
};
/** A quoted disclaimer is not evidence that an irrelevant passage was rejected. */
export function scoreKnowledgeQuality(
  cases: QualityCase[],
  rows: QualityRow[],
) {
  const expected = new Map(cases.map((item) => [item.id, item]));
  if (expected.size !== cases.length) throw Error("BLK-KNOWLEDGE-EVALUATION");
  const byId = new Map<string, QualityRow>();
  for (const row of rows) {
    if (
      !expected.has(row.id) ||
      byId.has(row.id) ||
      !["found", "no-evidence"].includes(row.status)
    )
      throw Error("BLK-KNOWLEDGE-EVALUATION");
    byId.set(row.id, row);
  }
  const answers = cases.filter((item) => item.kind === "answer"),
    absent = cases.filter((item) => item.kind === "no-answer");
  if (
    answers.length !== 20 ||
    absent.length !== 10 ||
    answers.some((item) => !item.relevant.length)
  )
    throw Error("BLK-KNOWLEDGE-EVALUATION");
  const answerHits = answers.filter((item) => {
    const row = byId.get(item.id);
    return (
      row?.status === "found" &&
      row.retrieved.slice(0, 5).some((id) => item.relevant.includes(id))
    );
  }).length;
  const noEvidence = absent.filter(
    (item) => byId.get(item.id)?.status === "no-evidence",
  ).length;
  const missing = cases
    .filter((item) => !byId.has(item.id))
    .map((item) => item.id);
  const deniedFailures = cases
    .filter(
      (item) =>
        item.kind === "denied" &&
        (byId.get(item.id)?.status !== "no-evidence" ||
          byId.get(item.id)!.retrieved.length !== 0),
    )
    .map((item) => item.id);
  return {
    deniedFailures,
    answerHits,
    answerTotal: answers.length,
    noEvidence,
    noEvidenceTotal: absent.length,
    missing,
    thresholds: { answerHits: 18, noEvidence: 9 },
    passed:
      deniedFailures.length === 0 &&
      missing.length === 0 &&
      answerHits >= 18 &&
      noEvidence >= 9,
  };
}
