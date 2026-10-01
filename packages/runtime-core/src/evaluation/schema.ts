import { z } from "zod";
import { stableId, type Json } from "@blocky/language-schema";

const id = z.string().max(128).regex(stableId);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const finiteScore = z.number().finite().min(0).max(1);

export const evaluationModelBindingSchema = z
  .object({
    resourceId: id,
    provider: z.string().min(1).max(128),
    modelId: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
  })
  .strict();
export type EvaluationModelBinding = z.infer<
  typeof evaluationModelBindingSchema
>;

export const evaluationBindingSchema = z
  .object({
    configurationHash: hash,
    model: evaluationModelBindingSchema,
  })
  .strict();
export type EvaluationBinding = z.infer<typeof evaluationBindingSchema>;

const expectedSchema = z
  .object({
    answer: z.string().max(65536).optional(),
    structured: z.json().optional(),
    citationIds: z.array(id).max(256).optional(),
    retrievalHitIds: z.array(id).max(256).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one expected value is required",
  });
export type EvaluationExpected = z.infer<typeof expectedSchema>;

export const evaluationCaseSchema = z
  .object({
    caseId: id,
    input: z.json(),
    expected: expectedSchema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  })
  .strict();
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;

export const evaluationDatasetSchema = z
  .object({
    schemaVersion: z.literal("blocky.evaluation-dataset/v1"),
    datasetId: id,
    version: z.number().int().min(1).max(65535),
    name: z.string().trim().min(1).max(128),
    createdAt: timestamp,
    frozenAt: timestamp.optional(),
    status: z.enum(["draft", "frozen"]),
    binding: evaluationBindingSchema,
    cases: z.array(evaluationCaseSchema).min(1).max(10000),
    contentHash: hash.optional(),
    bindingHash: hash.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const item of value.cases) {
      if (ids.has(item.caseId))
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: `Duplicate case id: ${item.caseId}`,
        });
      ids.add(item.caseId);
    }
    if (
      value.status === "frozen" &&
      (!value.contentHash || !value.bindingHash || value.frozenAt === undefined)
    )
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "Frozen datasets require content and binding hashes",
      });
    if (
      value.status === "draft" &&
      (value.contentHash || value.bindingHash || value.frozenAt !== undefined)
    )
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "Draft datasets cannot carry frozen hashes",
      });
  });
export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;

export const evaluationCandidateSchema = z
  .object({ id, version: z.string().min(1).max(128), contentHash: hash })
  .strict();
export type EvaluationCandidate = z.infer<typeof evaluationCandidateSchema>;

export const evaluationGenerationSchema = z
  .object({
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    transport: z.enum(["local", "remote"]),
    requestId: z.string().min(1).max(256),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type EvaluationGeneration = z.infer<typeof evaluationGenerationSchema>;

const runtimeGenerationSchema = z
  .object({
    schemaVersion: z.literal("blocky.model-response/v2").optional(),
    usageStatus: z.enum(["reported", "unavailable"]).optional(),
    text: z.string().max(65536),
    provider: z.string().min(1).max(128),
    transport: z.enum(["local", "remote"]),
    model: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .passthrough();

export const evaluationRuntimeResultSchema = z
  .object({
    status: z.enum(["completed", "failed", "cancelled", "waiting", "unknown"]),
    answer: z.string().max(65536).optional(),
    structured: z.json().optional(),
    citations: z
      .array(
        z
          .object({
            id,
            title: z.string().max(2048),
            text: z.string().max(32768),
          })
          .passthrough(),
      )
      .max(256)
      .optional(),
    retrievalHitIds: z.array(id).max(256).optional(),
    generations: z.array(runtimeGenerationSchema).max(64).optional(),
    errorCode: z
      .string()
      .regex(/^BLK-[A-Z0-9-]{3,64}$/)
      .optional(),
  })
  .passthrough();

export const evaluationCheckSchema = z.boolean().nullable();
export const evaluationRowSchema = z
  .object({
    caseId: id,
    status: z.enum(["completed", "failed", "uncertain"]),
    passed: z.boolean().nullable(),
    checks: z
      .object({
        correctness: evaluationCheckSchema,
        citations: evaluationCheckSchema,
        retrieval: evaluationCheckSchema,
      })
      .strict(),
    answerHash: hash.nullable(),
    structuredHash: hash.nullable(),
    structuredResult: z.json().optional(),
    citationIds: z.array(id).max(256),
    retrievalHitIds: z.array(id).max(256),
    generations: z.array(evaluationGenerationSchema).max(64),
    latencyMs: z.number().finite().nonnegative().nullable(),
    errorCode: z
      .string()
      .regex(/^BLK-[A-Z0-9-]{3,64}$/)
      .optional(),
  })
  .strict();
export type EvaluationRow = z.infer<typeof evaluationRowSchema>;

const accuracyMetricSchema = z
  .object({
    scored: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    accuracy: z.number().finite().min(0).max(1).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.passed <= value.scored &&
      (value.scored === 0
        ? value.accuracy === null
        : value.accuracy === value.passed / value.scored),
  );
export type EvaluationAccuracyMetric = z.infer<typeof accuracyMetricSchema>;

export const evaluationMetricsSchema = z
  .object({
    cases: z
      .object({
        total: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        uncertain: z.number().int().nonnegative(),
      })
      .strict()
      .refine(
        (value) =>
          value.completed + value.failed + value.uncertain <= value.total,
      ),
    correctness: accuracyMetricSchema,
    citations: accuracyMetricSchema,
    retrieval: accuracyMetricSchema,
    averageLatencyMs: z.number().finite().nonnegative().nullable(),
    usage: z
      .object({
        status: z.enum(["reported", "unavailable", "not-reported"]),
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        totalTokens: z.number().int().nonnegative().nullable(),
      })
      .strict()
      .refine((value) =>
        value.status === "reported"
          ? value.inputTokens !== null &&
            value.outputTokens !== null &&
            value.totalTokens !== null &&
            value.totalTokens === value.inputTokens + value.outputTokens
          : value.inputTokens === null &&
            value.outputTokens === null &&
            value.totalTokens === null,
      ),
  })
  .strict();
export type EvaluationMetrics = z.infer<typeof evaluationMetricsSchema>;

export const evaluationModelScoreSchema = z
  .object({
    caseId: id,
    score: finiteScore.optional(),
    errorCode: z
      .string()
      .regex(/^BLK-[A-Z0-9-]{3,64}$/)
      .optional(),
    generation: evaluationGenerationSchema.optional(),
  })
  .strict()
  .refine(
    (value) => (value.score !== undefined) !== (value.errorCode !== undefined),
  );

export const evaluationHumanRatingSchema = z
  .object({
    caseId: id,
    score: finiteScore,
    reviewerId: id.optional(),
    ratedAt: timestamp,
  })
  .strict();
export type EvaluationHumanRating = z.infer<typeof evaluationHumanRatingSchema>;

const scoringSchema = z
  .object({
    deterministic: evaluationMetricsSchema,
    model: z
      .object({
        status: z.enum(["not-run", "completed", "partial", "failed"]),
        binding: evaluationModelBindingSchema.optional(),
        rows: z.array(evaluationModelScoreSchema).max(10000),
      })
      .strict(),
    human: z.array(evaluationHumanRatingSchema).max(10000),
  })
  .strict();

export const evaluationReportSchema = z
  .object({
    schemaVersion: z.literal("blocky.evaluation-report/v1"),
    reportId: id,
    checkpointId: id,
    datasetId: id,
    datasetVersion: z.number().int().min(1).max(65535),
    datasetContentHash: hash,
    binding: evaluationBindingSchema,
    candidate: evaluationCandidateSchema,
    resultDetailPolicy: z.enum(["summary", "structured"]),
    status: z.enum(["partial", "completed"]),
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp.optional(),
    rows: z.array(evaluationRowSchema).max(10000),
    metrics: evaluationMetricsSchema,
    scoring: scoringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const cases = new Set<string>();
    for (const row of value.rows) {
      if (cases.has(row.caseId))
        context.addIssue({
          code: "custom",
          path: ["rows"],
          message: `Duplicate result for case ${row.caseId}`,
        });
      cases.add(row.caseId);
    }
    if (
      value.metrics.cases.completed !==
        value.rows.filter((row) => row.status === "completed").length ||
      value.metrics.cases.failed !==
        value.rows.filter((row) => row.status === "failed").length ||
      value.metrics.cases.uncertain !==
        value.rows.filter((row) => row.status === "uncertain").length ||
      value.metrics.cases.total < value.rows.length
    )
      context.addIssue({ code: "custom", path: ["metrics", "cases"] });
    if (
      (value.status === "completed" &&
        (value.completedAt === undefined ||
          value.completedAt < value.createdAt ||
          value.rows.length !== value.metrics.cases.total ||
          value.metrics.cases.completed +
            value.metrics.cases.failed +
            value.metrics.cases.uncertain !==
            value.metrics.cases.total)) ||
      (value.status === "partial" && value.completedAt !== undefined)
    )
      context.addIssue({ code: "custom", path: ["completedAt"] });
  });
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

const checkpointCaseSchema = z
  .object({
    caseId: id,
    status: z.enum(["pending", "started", "settled", "uncertain"]),
    result: evaluationRowSchema.optional(),
  })
  .strict()
  .refine((value) =>
    value.status === "settled" || value.status === "uncertain"
      ? value.result !== undefined
      : value.result === undefined,
  );

const checkpointScoringSchema = z
  .object({
    status: z.enum(["not-run", "completed", "partial", "failed"]),
    binding: evaluationModelBindingSchema.optional(),
    rows: z.array(evaluationModelScoreSchema).max(10000),
  })
  .strict();

export const evaluationCheckpointSchema = z
  .object({
    schemaVersion: z.literal("blocky.evaluation-checkpoint/v1"),
    checkpointId: id,
    reportId: id,
    datasetId: id,
    datasetVersion: z.number().int().min(1).max(65535),
    datasetContentHash: hash,
    binding: evaluationBindingSchema,
    candidate: evaluationCandidateSchema,
    resultDetailPolicy: z.enum(["summary", "structured"]),
    status: z.enum(["running", "cancelled", "completed"]),
    createdAt: timestamp,
    updatedAt: timestamp,
    cases: z.array(checkpointCaseSchema).min(1).max(10000),
    modelScoring: checkpointScoringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, item] of value.cases.entries()) {
      if (ids.has(item.caseId))
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
        });
      ids.add(item.caseId);
      if (item.result && item.result.caseId !== item.caseId)
        context.addIssue({
          code: "custom",
          path: ["cases", index, "result", "caseId"],
        });
    }
    if (
      value.status === "completed" &&
      value.cases.some(
        (item) => item.status === "pending" || item.status === "started",
      )
    )
      context.addIssue({ code: "custom", path: ["status"] });
  });
export type EvaluationCheckpoint = z.infer<typeof evaluationCheckpointSchema>;

export const evaluationImportSchema = evaluationDatasetSchema;
export function asEvaluationJson(value: unknown): Json {
  return z.json().parse(value) as Json;
}
