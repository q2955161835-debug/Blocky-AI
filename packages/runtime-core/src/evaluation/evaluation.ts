import { canonicalJson, type Json } from "@blocky/language-schema";
import { redact } from "@blocky/observability";
import type { Citation } from "../adapters";
import { checkGenerationMetadata, type Generation } from "../agent-context";
import {
  assertFrozenDataset,
  digestEvaluationValue,
  saveEvaluationAsset,
  type EvaluationAssetStore,
} from "./assets";
import {
  evaluationBindingSchema,
  evaluationCandidateSchema,
  evaluationCheckpointSchema,
  evaluationHumanRatingSchema,
  evaluationModelBindingSchema,
  evaluationReportSchema,
  evaluationRuntimeResultSchema,
  type EvaluationAccuracyMetric,
  type EvaluationBinding,
  type EvaluationCandidate,
  type EvaluationCase,
  type EvaluationCheckpoint,
  type EvaluationDataset,
  type EvaluationGeneration,
  type EvaluationHumanRating,
  type EvaluationModelBinding,
  type EvaluationReport,
  type EvaluationRow,
} from "./schema";

export type EvaluationRunResult = {
  status: "completed" | "failed" | "cancelled" | "waiting" | "unknown";
  answer?: string;
  structured?: Json;
  citations?: Citation[];
  retrievalHitIds?: string[];
  generations?: Generation[];
  errorCode?: string;
};

export type EvaluationExecutionContext = {
  signal: AbortSignal;
  candidate: EvaluationCandidate;
  binding: EvaluationBinding;
};

export type EvaluationModelScore = {
  score: number;
  binding: EvaluationModelBinding;
  generation: Generation;
};

export type EvaluationModelScorer = {
  binding: EvaluationModelBinding;
  score: (
    input: { testCase: EvaluationCase; result: EvaluationRunResult },
    signal: AbortSignal,
  ) => Promise<EvaluationModelScore>;
};

export class EvaluationRunnerError extends Error {
  constructor(
    readonly code: string,
    readonly sideEffects: "none" | "unknown",
  ) {
    super(code);
    this.name = "EvaluationRunnerError";
  }
}

export type EvaluationCheckpointReference = {
  value: EvaluationCheckpoint;
  revision: number;
};

export type RunEvaluationOptions = {
  dataset: EvaluationDataset;
  candidate: EvaluationCandidate;
  checkpointId: string;
  reportId: string;
  store: EvaluationAssetStore;
  execute: (
    testCase: EvaluationCase,
    context: EvaluationExecutionContext,
  ) => Promise<EvaluationRunResult>;
  signal?: AbortSignal;
  checkpoint?: EvaluationCheckpointReference;
  scorer?: EvaluationModelScorer;
  resultDetailPolicy?: "summary" | "structured";
  now?: () => number;
  monotonicNow?: () => number;
};

export type RunEvaluationResult = {
  report: EvaluationReport;
  checkpoint: EvaluationCheckpointReference;
};

const stableCodePattern = /^BLK-[A-Z0-9-]{3,64}$/;

function schema<T>(
  parsed: { success: boolean; data?: T },
  error = "BLK-EVAL-SCHEMA",
): T {
  if (!parsed.success) throw new EvaluationValidationError(error);
  return parsed.data as T;
}

class EvaluationValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function stableErrorCode(value: unknown, fallback: string): string {
  return typeof value === "string" && stableCodePattern.test(value)
    ? value
    : fallback;
}

function sameIds(expected: string[], actual: string[]): boolean {
  const left = [...new Set(expected)].sort();
  const right = [...new Set(actual)].sort();
  return (
    left.length === right.length && left.every((value, i) => value === right[i])
  );
}

function includesIds(expected: string[], actual: string[]): boolean {
  const values = new Set(actual);
  return expected.every((value) => values.has(value));
}

function expectedChecks(
  testCase: EvaluationCase,
  result: EvaluationRunResult | undefined,
  status: EvaluationRow["status"],
) {
  const expected = testCase.expected;
  const knownFailure = status === "failed";
  const correctness =
    expected &&
    (expected.answer !== undefined || expected.structured !== undefined)
      ? knownFailure
        ? false
        : result
          ? (expected.answer === undefined ||
              result.answer === expected.answer) &&
            (expected.structured === undefined ||
              (result.structured !== undefined &&
                canonicalJson(result.structured) ===
                  canonicalJson(expected.structured)))
          : null
      : null;
  const citations =
    expected?.citationIds !== undefined
      ? knownFailure
        ? false
        : result
          ? sameIds(
              expected.citationIds,
              (result.citations ?? []).map((item) => item.id),
            )
          : null
      : null;
  const retrieval =
    expected?.retrievalHitIds !== undefined
      ? knownFailure
        ? false
        : result
          ? includesIds(expected.retrievalHitIds, result.retrievalHitIds ?? [])
          : null
      : null;
  const values = [correctness, citations, retrieval].filter(
    (value): value is boolean => value !== null,
  );
  return {
    checks: { correctness, citations, retrieval },
    passed: values.length === 0 ? null : values.every(Boolean),
  };
}

function safeSummary(value: Generation): EvaluationGeneration {
  try {
    checkGenerationMetadata(value);
  } catch {
    throw new EvaluationValidationError("BLK-EVAL-RUN-RESULT");
  }
  return {
    provider: value.provider,
    model: value.model,
    transport: value.transport,
    requestId: value.requestId,
    usage: value.usage,
  };
}

async function rowFromResult(
  testCase: EvaluationCase,
  result: EvaluationRunResult,
  latencyMs: number,
  binding: EvaluationBinding,
  resultDetailPolicy: "summary" | "structured",
): Promise<EvaluationRow> {
  const parsed = schema(
    evaluationRuntimeResultSchema.safeParse(result),
    "BLK-EVAL-RUN-RESULT",
  );
  const generations = (parsed.generations ?? []).map(safeSummary);
  if (
    generations.some(
      (generation) =>
        generation.provider !== binding.model.provider ||
        generation.model !== binding.model.modelId,
    )
  )
    throw new EvaluationValidationError("BLK-EVAL-MODEL-BINDING");
  const citationIds = [
    ...new Set((parsed.citations ?? []).map((item) => item.id)),
  ];
  const retrievalHitIds = [...new Set(parsed.retrievalHitIds ?? [])];
  if (parsed.status !== "completed") {
    const status = parsed.status === "failed" ? "failed" : "uncertain";
    const checks = expectedChecks(testCase, undefined, status);
    return {
      caseId: testCase.caseId,
      status,
      passed: checks.passed,
      checks: checks.checks,
      answerHash: null,
      structuredHash: null,
      citationIds,
      retrievalHitIds,
      generations,
      latencyMs,
      errorCode: stableErrorCode(
        parsed.errorCode,
        parsed.status === "waiting"
          ? "BLK-EVAL-RUN-WAITING"
          : parsed.status === "failed"
            ? "BLK-EVAL-RUN-FAILED"
            : "BLK-EVAL-OUTCOME-UNKNOWN",
      ),
    };
  }

  const checks = expectedChecks(testCase, parsed, "completed");
  return {
    caseId: testCase.caseId,
    status: "completed",
    passed: checks.passed,
    checks: checks.checks,
    answerHash:
      parsed.answer === undefined
        ? null
        : await safeDigest(parsed.answer as unknown as Json),
    structuredHash:
      parsed.structured === undefined
        ? null
        : await safeDigest(parsed.structured),
    ...(resultDetailPolicy === "structured" && parsed.structured !== undefined
      ? { structuredResult: redact(parsed.structured).value }
      : {}),
    citationIds,
    retrievalHitIds,
    generations,
    latencyMs,
  };
}

async function safeDigest(value: Json): Promise<string> {
  try {
    return await digestEvaluationValue(value);
  } catch {
    throw new EvaluationValidationError("BLK-EVAL-HASH-UNAVAILABLE");
  }
}

function failedRow(
  testCase: EvaluationCase,
  status: "failed" | "uncertain",
  errorCode: string,
  latencyMs: number | null,
): EvaluationRow {
  const checks = expectedChecks(testCase, undefined, status);
  return {
    caseId: testCase.caseId,
    status,
    passed: checks.passed,
    checks: checks.checks,
    answerHash: null,
    structuredHash: null,
    citationIds: [],
    retrievalHitIds: [],
    generations: [],
    latencyMs,
    errorCode,
  };
}

function metric(
  rows: EvaluationRow[],
  field: keyof EvaluationRow["checks"],
): EvaluationAccuracyMetric {
  const values = rows
    .map((row) => row.checks[field])
    .filter((value): value is boolean => value !== null);
  const passed = values.filter(Boolean).length;
  return {
    scored: values.length,
    passed,
    accuracy: values.length ? passed / values.length : null,
  };
}

function summarizeMetrics(
  dataset: EvaluationDataset,
  rows: EvaluationRow[],
  scorerRows: EvaluationCheckpoint["modelScoring"]["rows"],
) {
  const generations = [...rows.flatMap((row) => row.generations)];
  const allGenerations = [
    ...generations,
    ...scorerRows.flatMap((row) => (row.generation ? [row.generation] : [])),
  ];
  const unknownUsage =
    allGenerations.some((generation) => generation.usage === null) ||
    (allGenerations.length === 0 &&
      rows.some((row) => row.status === "uncertain")) ||
    scorerRows.some((row) => row.errorCode !== undefined);
  const hasUsage = allGenerations.length > 0;
  const total = allGenerations.reduce(
    (sum, generation) => ({
      inputTokens: sum.inputTokens + (generation.usage?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (generation.usage?.outputTokens ?? 0),
      totalTokens: sum.totalTokens + (generation.usage?.totalTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
  const latencies = rows.flatMap((row) =>
    row.latencyMs === null ? [] : [row.latencyMs],
  );
  return {
    cases: {
      total: dataset.cases.length,
      completed: rows.filter((row) => row.status === "completed").length,
      failed: rows.filter((row) => row.status === "failed").length,
      uncertain: rows.filter((row) => row.status === "uncertain").length,
    },
    correctness: metric(rows, "correctness"),
    citations: metric(rows, "citations"),
    retrieval: metric(rows, "retrieval"),
    averageLatencyMs: latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : null,
    usage: {
      status: unknownUsage
        ? "unavailable"
        : hasUsage
          ? "reported"
          : "not-reported",
      inputTokens: !hasUsage || unknownUsage ? null : total.inputTokens,
      outputTokens: !hasUsage || unknownUsage ? null : total.outputTokens,
      totalTokens: !hasUsage || unknownUsage ? null : total.totalTokens,
    },
  } as const;
}

function reportFromCheckpoint(
  dataset: EvaluationDataset,
  checkpoint: EvaluationCheckpoint,
  now: number,
): EvaluationReport {
  const rows = checkpoint.cases.flatMap((item) =>
    item.result ? [item.result] : [],
  );
  const modelRows = checkpoint.modelScoring.rows;
  const goodModelRows = modelRows.filter(
    (item) => item.score !== undefined,
  ).length;
  const badModelRows = modelRows.length - goodModelRows;
  let modelStatus = checkpoint.modelScoring.status;
  if (checkpoint.modelScoring.binding) {
    modelStatus =
      badModelRows === 0 && goodModelRows > 0
        ? "completed"
        : goodModelRows === 0 && badModelRows > 0
          ? "failed"
          : "partial";
  }
  const scoring = {
    deterministic: summarizeMetrics(
      dataset,
      rows,
      checkpoint.modelScoring.rows,
    ),
    model: {
      status: modelStatus,
      ...(checkpoint.modelScoring.binding
        ? { binding: checkpoint.modelScoring.binding }
        : {}),
      rows: modelRows,
    },
    human: [],
  };
  const value = {
    schemaVersion: "blocky.evaluation-report/v1" as const,
    reportId: checkpoint.reportId,
    checkpointId: checkpoint.checkpointId,
    datasetId: checkpoint.datasetId,
    datasetVersion: checkpoint.datasetVersion,
    datasetContentHash: checkpoint.datasetContentHash,
    binding: checkpoint.binding,
    candidate: checkpoint.candidate,
    resultDetailPolicy: checkpoint.resultDetailPolicy,
    status:
      checkpoint.status === "completed"
        ? ("completed" as const)
        : ("partial" as const),
    createdAt: checkpoint.createdAt,
    updatedAt: now,
    ...(checkpoint.status === "completed" ? { completedAt: now } : {}),
    rows,
    metrics: scoring.deterministic,
    scoring,
  };
  return schema(evaluationReportSchema.safeParse(value));
}

function abortError() {
  const error = Error("BLK-EVAL-CANCELLED");
  error.name = "AbortError";
  return error;
}

function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let aborted = signal.aborted;
    const onAbort = () => {
      aborted = true;
    };
    if (!aborted) signal.addEventListener("abort", onAbort, { once: true });
    const settle = () => signal.removeEventListener("abort", onAbort);
    work.then(
      (value) => {
        settle();
        if (aborted || signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error) => {
        settle();
        reject(aborted || signal.aborted ? abortError() : error);
      },
    );
  });
}

function newCheckpoint(
  dataset: EvaluationDataset,
  candidate: EvaluationCandidate,
  checkpointId: string,
  reportId: string,
  createdAt: number,
  resultDetailPolicy: "summary" | "structured",
  scorer?: EvaluationModelScorer,
): EvaluationCheckpoint {
  return schema(
    evaluationCheckpointSchema.safeParse({
      schemaVersion: "blocky.evaluation-checkpoint/v1",
      checkpointId,
      reportId,
      datasetId: dataset.datasetId,
      datasetVersion: dataset.version,
      datasetContentHash: dataset.contentHash!,
      binding: dataset.binding,
      candidate,
      resultDetailPolicy,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      cases: dataset.cases.map((testCase) => ({
        caseId: testCase.caseId,
        status: "pending",
      })),
      modelScoring: {
        status: scorer ? "partial" : "not-run",
        ...(scorer ? { binding: scorer.binding } : {}),
        rows: [],
      },
    }),
  );
}

function requireSameRun(
  checkpoint: EvaluationCheckpoint,
  dataset: EvaluationDataset,
  candidate: EvaluationCandidate,
  checkpointId: string,
  reportId: string,
  resultDetailPolicy: "summary" | "structured",
) {
  const sameCases =
    checkpoint.cases.length === dataset.cases.length &&
    checkpoint.cases.every(
      (item, index) => item.caseId === dataset.cases[index]?.caseId,
    );
  if (
    checkpoint.checkpointId !== checkpointId ||
    checkpoint.reportId !== reportId ||
    checkpoint.resultDetailPolicy !== resultDetailPolicy ||
    checkpoint.datasetId !== dataset.datasetId ||
    checkpoint.datasetVersion !== dataset.version ||
    checkpoint.datasetContentHash !== dataset.contentHash ||
    canonicalJson(checkpoint.binding as unknown as Json) !==
      canonicalJson(dataset.binding as unknown as Json) ||
    canonicalJson(checkpoint.candidate as unknown as Json) !==
      canonicalJson(candidate as unknown as Json) ||
    !sameCases
  )
    throw Error("BLK-EVAL-CHECKPOINT-BINDING");
}

export async function runEvaluation(
  options: RunEvaluationOptions,
): Promise<RunEvaluationResult> {
  const dataset = await assertFrozenDataset(options.dataset);
  const candidate = schema(
    evaluationCandidateSchema.safeParse(options.candidate),
  );
  if (options.scorer)
    schema(evaluationModelBindingSchema.safeParse(options.scorer.binding));
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const signal = options.signal ?? new AbortController().signal;
  const resultDetailPolicy = options.resultDetailPolicy ?? "summary";
  const binding = schema(evaluationBindingSchema.safeParse(dataset.binding));
  let checkpoint: EvaluationCheckpoint;
  let revision: number;

  if (options.checkpoint) {
    checkpoint = schema(
      evaluationCheckpointSchema.safeParse(options.checkpoint.value),
    );
    requireSameRun(
      checkpoint,
      dataset,
      candidate,
      options.checkpointId,
      options.reportId,
      resultDetailPolicy,
    );
    const stored = await options.store.read(
      "checkpoint",
      checkpoint.checkpointId,
    );
    if (
      !stored ||
      stored.revision !== options.checkpoint.revision ||
      stored.kind !== "checkpoint" ||
      canonicalJson(stored.value as unknown as Json) !==
        canonicalJson(checkpoint as unknown as Json)
    )
      throw Error("BLK-EVAL-CAS");
    revision = stored.revision;
    if (
      !!options.scorer !== !!checkpoint.modelScoring.binding ||
      (options.scorer &&
        checkpoint.modelScoring.binding &&
        canonicalJson(options.scorer.binding as unknown as Json) !==
          canonicalJson(checkpoint.modelScoring.binding as unknown as Json))
    )
      throw Error("BLK-EVAL-SCORER-BINDING");
  } else {
    checkpoint = newCheckpoint(
      dataset,
      candidate,
      options.checkpointId,
      options.reportId,
      now(),
      resultDetailPolicy,
      options.scorer,
    );
    const saved = await saveEvaluationAsset(
      options.store,
      "checkpoint",
      checkpoint,
      null,
    );
    revision = saved.revision;
  }

  const persistCheckpoint = async (next: EvaluationCheckpoint) => {
    const saved = await saveEvaluationAsset(
      options.store,
      "checkpoint",
      next,
      revision,
    );
    checkpoint = next;
    revision = saved.revision;
  };

  for (let index = 0; index < checkpoint.cases.length; index++) {
    const state = checkpoint.cases[index]!;
    if (state.status === "settled" || state.status === "uncertain") continue;
    const testCase = dataset.cases[index]!;

    if (state.status === "started") {
      const result = failedRow(
        testCase,
        "uncertain",
        "BLK-EVAL-OUTCOME-UNKNOWN",
        null,
      );
      const cases = checkpoint.cases.map((item, itemIndex) =>
        itemIndex === index
          ? { caseId: item.caseId, status: "uncertain" as const, result }
          : item,
      );
      await persistCheckpoint({ ...checkpoint, cases, updatedAt: now() });
      continue;
    }

    if (signal.aborted) {
      await persistCheckpoint({
        ...checkpoint,
        status: "cancelled",
        updatedAt: now(),
      });
      break;
    }

    const startedAt = monotonicNow();
    const casesStarted = checkpoint.cases.map((item, itemIndex) =>
      itemIndex === index
        ? { caseId: item.caseId, status: "started" as const }
        : item,
    );
    await persistCheckpoint({
      ...checkpoint,
      status: "running",
      cases: casesStarted,
      updatedAt: now(),
    });

    let runResult: EvaluationRunResult | undefined;
    let row: EvaluationRow;
    try {
      const raw = await awaitAbortable(
        Promise.resolve().then(() => {
          if (signal.aborted) throw abortError();
          return options.execute(testCase, { signal, candidate, binding });
        }),
        signal,
      );
      runResult = schema(
        evaluationRuntimeResultSchema.safeParse(raw),
        "BLK-EVAL-RUN-RESULT",
      );
      const latencyMs = Math.max(0, monotonicNow() - startedAt);
      row = await rowFromResult(
        testCase,
        runResult,
        latencyMs,
        binding,
        resultDetailPolicy,
      );
    } catch (error) {
      const latencyMs = Math.max(0, monotonicNow() - startedAt);
      if (
        error instanceof EvaluationRunnerError &&
        error.sideEffects === "none"
      ) {
        row = failedRow(
          testCase,
          "failed",
          stableErrorCode(error.code, "BLK-EVAL-RUN-FAILED"),
          latencyMs,
        );
      } else if (error instanceof EvaluationRunnerError) {
        row = failedRow(
          testCase,
          "uncertain",
          stableErrorCode(error.code, "BLK-EVAL-OUTCOME-UNKNOWN"),
          latencyMs,
        );
      } else if (error instanceof EvaluationValidationError) {
        row = failedRow(testCase, "failed", error.code, latencyMs);
      } else if (signal.aborted) {
        row = failedRow(
          testCase,
          "uncertain",
          "BLK-EVAL-OUTCOME-UNKNOWN",
          latencyMs,
        );
      } else {
        row = failedRow(
          testCase,
          "uncertain",
          stableErrorCode(
            (error as { code?: unknown } | null)?.code,
            "BLK-EVAL-OUTCOME-UNKNOWN",
          ),
          latencyMs,
        );
      }
    }

    let modelScoring = checkpoint.modelScoring;
    if (
      options.scorer &&
      row.status === "completed" &&
      runResult &&
      !signal.aborted
    ) {
      try {
        const scored = await awaitAbortable(
          options.scorer.score({ testCase, result: runResult }, signal),
          signal,
        );
        const score =
          Number.isFinite(scored.score) &&
          scored.score >= 0 &&
          scored.score <= 1
            ? scored.score
            : undefined;
        const checkedGeneration = await safeSummary(scored.generation);
        const bindingMatches =
          canonicalJson(scored.binding as unknown as Json) ===
            canonicalJson(options.scorer.binding as unknown as Json) &&
          checkedGeneration.provider === scored.binding.provider &&
          checkedGeneration.model === scored.binding.modelId;
        if (score === undefined || !bindingMatches)
          throw Error("BLK-EVAL-SCORER-BINDING");
        modelScoring = {
          status: "partial",
          binding: options.scorer.binding,
          rows: [
            ...modelScoring.rows,
            { caseId: testCase.caseId, score, generation: checkedGeneration },
          ],
        };
      } catch (error) {
        modelScoring = {
          status: "partial",
          binding: options.scorer.binding,
          rows: [
            ...modelScoring.rows,
            {
              caseId: testCase.caseId,
              errorCode: stableErrorCode(
                (error as { message?: unknown } | null)?.message,
                "BLK-EVAL-MODEL-UNKNOWN",
              ),
            },
          ],
        };
      }
    }

    const terminalStatus =
      row.status === "uncertain"
        ? ("uncertain" as const)
        : ("settled" as const);
    const casesSettled = checkpoint.cases.map((item, itemIndex) =>
      itemIndex === index
        ? { caseId: item.caseId, status: terminalStatus, result: row }
        : item,
    );
    await persistCheckpoint({
      ...checkpoint,
      status: signal.aborted ? "cancelled" : "running",
      cases: casesSettled,
      modelScoring,
      updatedAt: now(),
    });
    if (signal.aborted) break;
  }

  if (
    checkpoint.status !== "completed" &&
    signal.aborted &&
    checkpoint.status !== "cancelled"
  )
    await persistCheckpoint({
      ...checkpoint,
      status: "cancelled",
      updatedAt: now(),
    });
  else if (checkpoint.status !== "completed" && !signal.aborted)
    await persistCheckpoint({
      ...checkpoint,
      status: "completed",
      updatedAt: now(),
    });

  const report = reportFromCheckpoint(dataset, checkpoint, now());
  const currentReport = await options.store.read("report", report.reportId);
  if (currentReport && currentReport.kind === "report") {
    if (
      currentReport.value.checkpointId !== checkpoint.checkpointId ||
      currentReport.value.datasetContentHash !== report.datasetContentHash
    )
      throw Error("BLK-EVAL-REPORT-IMMUTABLE");
    if (currentReport.value.status === "completed")
      return {
        report: currentReport.value,
        checkpoint: { value: checkpoint, revision },
      };
  }
  await saveEvaluationAsset(
    options.store,
    "report",
    report,
    currentReport?.revision ?? null,
  );
  return { report, checkpoint: { value: checkpoint, revision } };
}

export function addEvaluationHumanRating(
  input: unknown,
  ratingInput: EvaluationHumanRating,
): EvaluationReport {
  const report = schema(evaluationReportSchema.safeParse(input));
  const checked = schema(evaluationHumanRatingSchema.safeParse(ratingInput));
  if (!report.rows.some((row) => row.caseId === checked.caseId))
    throw Error("BLK-EVAL-CASE-NOT-FOUND");
  if (
    checked.reviewerId &&
    report.scoring.human.some(
      (item) =>
        item.caseId === checked.caseId &&
        item.reviewerId === checked.reviewerId,
    )
  )
    throw Error("BLK-EVAL-RATING-CONFLICT");
  return schema(
    evaluationReportSchema.safeParse({
      ...report,
      scoring: { ...report.scoring, human: [...report.scoring.human, checked] },
    }),
  );
}

export function compareEvaluationReports(
  firstInput: unknown,
  secondInput: unknown,
) {
  const first = schema(evaluationReportSchema.safeParse(firstInput));
  const second = schema(evaluationReportSchema.safeParse(secondInput));
  if (
    first.status !== "completed" ||
    second.status !== "completed" ||
    first.datasetId !== second.datasetId ||
    first.datasetContentHash !== second.datasetContentHash
  )
    throw Error("BLK-EVAL-COMPARE-DATASET");
  const firstRows = new Map(first.rows.map((row) => [row.caseId, row]));
  const secondRows = new Map(second.rows.map((row) => [row.caseId, row]));
  if (
    firstRows.size !== secondRows.size ||
    [...firstRows.keys()].some((caseId) => !secondRows.has(caseId))
  )
    throw Error("BLK-EVAL-COMPARE-CASES");
  const changedCaseIds = [...firstRows.keys()].filter((caseId) => {
    const before = firstRows.get(caseId)!;
    const after = secondRows.get(caseId)!;
    return (
      before.status !== after.status ||
      before.passed !== after.passed ||
      before.answerHash !== after.answerHash ||
      before.structuredHash !== after.structuredHash ||
      canonicalJson(before.checks as unknown as Json) !==
        canonicalJson(after.checks as unknown as Json) ||
      !sameIds(before.citationIds, after.citationIds) ||
      !sameIds(before.retrievalHitIds, after.retrievalHitIds)
    );
  });
  const beforeAccuracy = first.metrics.correctness.accuracy;
  const afterAccuracy = second.metrics.correctness.accuracy;
  return {
    schemaVersion: "blocky.evaluation-comparison/v1" as const,
    datasetId: first.datasetId,
    datasetContentHash: first.datasetContentHash,
    candidateVersions: [
      first.candidate.version,
      second.candidate.version,
    ] as const,
    accuracyDelta:
      beforeAccuracy === null || afterAccuracy === null
        ? null
        : afterAccuracy - beforeAccuracy,
    changedCaseIds,
    caseCountDelta: second.rows.length - first.rows.length,
  };
}
