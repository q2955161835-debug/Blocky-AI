import { stableId, type Json } from "@blocky/language-schema";
import { z } from "zod";
import type {
  EvaluationAssetKind,
  EvaluationAssetStore,
  EvaluationStoredAsset,
} from "./assets";
import {
  evaluationCheckpointSchema,
  evaluationDatasetSchema,
  evaluationReportSchema,
  type EvaluationCheckpoint,
  type EvaluationDataset,
  type EvaluationReport,
} from "./schema";

const stableKey = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const identitySchema = z
  .object({
    schemaVersion: z.literal("blocky.evaluation-asset-request/v1"),
    requestId: z.string().max(128).regex(stableId),
    projectId: z.string().max(128).regex(stableId),
    sessionId: z.string().max(128).regex(stableId),
  })
  .strict();

export const evaluationAssetRequestSchema = z.union([
  identitySchema
    .extend({
      action: z.literal("read"),
      kind: z.enum(["dataset", "report", "checkpoint"]),
      key: stableKey,
    })
    .strict(),
  identitySchema
    .extend({
      action: z.literal("cas"),
      kind: z.literal("dataset"),
      key: stableKey,
      expectedRevision: revisionSchema.nullable(),
      value: evaluationDatasetSchema,
    })
    .strict(),
  identitySchema
    .extend({
      action: z.literal("cas"),
      kind: z.literal("report"),
      key: stableKey,
      expectedRevision: revisionSchema.nullable(),
      value: evaluationReportSchema,
    })
    .strict(),
  identitySchema
    .extend({
      action: z.literal("cas"),
      kind: z.literal("checkpoint"),
      key: stableKey,
      expectedRevision: revisionSchema.nullable(),
      value: evaluationCheckpointSchema,
    })
    .strict(),
  identitySchema
    .extend({
      action: z.literal("list"),
      kind: z.enum(["dataset", "report", "checkpoint"]),
    })
    .strict(),
]);
export type EvaluationAssetRequest = z.infer<
  typeof evaluationAssetRequestSchema
>;
type EvaluationAssetRequestFields = EvaluationAssetRequest extends infer Request
  ? Request extends EvaluationAssetRequest
    ? Omit<Request, "schemaVersion" | "requestId" | "projectId" | "sessionId">
    : never
  : never;

const assetMetadataSchema = z
  .object({
    kind: z.enum(["dataset", "report", "checkpoint"]),
    key: stableKey,
    revision: revisionSchema,
  })
  .strict();
const datasetRecordSchema = z
  .object({
    kind: z.literal("dataset"),
    key: stableKey,
    revision: revisionSchema,
    value: evaluationDatasetSchema,
  })
  .strict();
const reportRecordSchema = z
  .object({
    kind: z.literal("report"),
    key: stableKey,
    revision: revisionSchema,
    value: evaluationReportSchema,
  })
  .strict();
const checkpointRecordSchema = z
  .object({
    kind: z.literal("checkpoint"),
    key: stableKey,
    revision: revisionSchema,
    value: evaluationCheckpointSchema,
  })
  .strict();
const recordSchema = z.union([
  datasetRecordSchema,
  reportRecordSchema,
  checkpointRecordSchema,
]);
const listReplySchema = z
  .object({ assets: z.array(assetMetadataSchema).max(10000) })
  .strict();

export type NativeEvaluationPort = (
  request: EvaluationAssetRequest,
  signal: AbortSignal,
) => Promise<Json>;

function checked<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw Error(code);
  return result.data;
}

function valueFor(kind: EvaluationAssetKind, value: unknown) {
  if (kind === "dataset")
    return checked(evaluationDatasetSchema, value, "BLK-EVAL-HOST-REQUEST");
  if (kind === "report")
    return checked(evaluationReportSchema, value, "BLK-EVAL-HOST-REQUEST");
  return checked(evaluationCheckpointSchema, value, "BLK-EVAL-HOST-REQUEST");
}

/** Typed adapter for the Host-owned, revision-checked evaluation asset API. */
export class NativeEvaluationStore implements EvaluationAssetStore {
  constructor(
    private readonly port: NativeEvaluationPort,
    private readonly projectId: string,
    private readonly sessionId: string,
    private readonly signal: AbortSignal,
  ) {
    if (!stableId.test(projectId) || !stableId.test(sessionId))
      throw Error("BLK-EVAL-HOST-REQUEST");
  }

  private async request(fields: EvaluationAssetRequestFields): Promise<Json> {
    this.signal.throwIfAborted();
    const request = checked(
      evaluationAssetRequestSchema,
      {
        schemaVersion: "blocky.evaluation-asset-request/v1",
        requestId: `evaluation-${globalThis.crypto.randomUUID()}`,
        projectId: this.projectId,
        sessionId: this.sessionId,
        ...fields,
      },
      "BLK-EVAL-HOST-REQUEST",
    );
    const response = await this.port(request, this.signal);
    this.signal.throwIfAborted();
    return response;
  }

  async read(
    kind: EvaluationAssetKind,
    key: string,
  ): Promise<EvaluationStoredAsset | null> {
    const raw = await this.request({ action: "read", kind, key });
    if (raw === null) return null;
    const record = checked(recordSchema, raw, "BLK-EVAL-HOST-RESPONSE");
    if (record.kind !== kind || record.key !== key)
      throw Error("BLK-EVAL-HOST-RESPONSE");
    return record as EvaluationStoredAsset;
  }

  async compareAndSwap(
    kind: EvaluationAssetKind,
    key: string,
    expectedRevision: number | null,
    value: EvaluationDataset | EvaluationReport | EvaluationCheckpoint,
  ): Promise<EvaluationStoredAsset> {
    const checkedValue = valueFor(kind, value);
    const raw = await this.request({
      action: "cas",
      kind,
      key,
      expectedRevision,
      value: checkedValue,
    } as EvaluationAssetRequestFields);
    const record = checked(recordSchema, raw, "BLK-EVAL-HOST-RESPONSE");
    if (record.kind !== kind || record.key !== key)
      throw Error("BLK-EVAL-HOST-RESPONSE");
    return record as EvaluationStoredAsset;
  }

  async list(kind: EvaluationAssetKind) {
    const raw = await this.request({ action: "list", kind });
    const reply = checked(listReplySchema, raw, "BLK-EVAL-HOST-RESPONSE");
    if (reply.assets.some((asset) => asset.kind !== kind))
      throw Error("BLK-EVAL-HOST-RESPONSE");
    return reply.assets;
  }
}
