import { canonicalJson, type Json } from "@blocky/language-schema";
import {
  evaluationCheckpointSchema,
  evaluationDatasetSchema,
  evaluationReportSchema,
  type EvaluationBinding,
  type EvaluationCase,
  type EvaluationCheckpoint,
  type EvaluationDataset,
  type EvaluationReport,
} from "./schema";

export type EvaluationAssetKind = "dataset" | "report" | "checkpoint";
export type EvaluationStoredAsset =
  | {
      kind: "dataset";
      key: string;
      revision: number;
      value: EvaluationDataset;
    }
  | {
      kind: "report";
      key: string;
      revision: number;
      value: EvaluationReport;
    }
  | {
      kind: "checkpoint";
      key: string;
      revision: number;
      value: EvaluationCheckpoint;
    };

/** Host owns durable storage. Implementations must compare revisions atomically. */
export interface EvaluationAssetStore {
  read(
    kind: EvaluationAssetKind,
    key: string,
  ): Promise<EvaluationStoredAsset | null>;
  compareAndSwap(
    kind: EvaluationAssetKind,
    key: string,
    expectedRevision: number | null,
    value: EvaluationDataset | EvaluationReport | EvaluationCheckpoint,
  ): Promise<EvaluationStoredAsset>;
}

function requireValid<T>(result: { success: boolean; data?: T }): T {
  if (!result.success) throw Error("BLK-EVAL-SCHEMA");
  return result.data as T;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestEvaluationValue(value: Json): Promise<string> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) throw Error("BLK-EVAL-HASH-UNAVAILABLE");
  const digest = await cryptoApi.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return hex(new Uint8Array(digest));
}

async function expectedHashes(dataset: EvaluationDataset) {
  const contentHash = await digestEvaluationValue({
    name: dataset.name,
    cases: dataset.cases,
  });
  const bindingHash = await digestEvaluationValue(
    dataset.binding as unknown as Json,
  );
  return { contentHash, bindingHash };
}

function createDatasetVersion(input: {
  datasetId: string;
  name: string;
  version: number;
  binding: EvaluationBinding;
  createdAt: number;
  cases: EvaluationCase[];
}): EvaluationDataset {
  const parsed = evaluationDatasetSchema.safeParse({
    schemaVersion: "blocky.evaluation-dataset/v1",
    ...input,
    version: input.version,
    status: "draft",
  });
  return requireValid(parsed);
}

export function createEvaluationDataset(input: {
  datasetId: string;
  name: string;
  binding: EvaluationBinding;
  createdAt: number;
  cases: EvaluationCase[];
}): EvaluationDataset {
  return createDatasetVersion({ ...input, version: 1 });
}

export async function freezeEvaluationDataset(
  input: unknown,
  frozenAt?: number,
): Promise<EvaluationDataset> {
  const dataset = requireValid(evaluationDatasetSchema.safeParse(input));
  if (dataset.status === "frozen") return importEvaluationDataset(dataset);
  const draft = evaluationDatasetSchema.parse({
    ...dataset,
  });
  const hashes = await expectedHashes(draft);
  return requireValid(
    evaluationDatasetSchema.safeParse({
      ...draft,
      status: "frozen",
      frozenAt: frozenAt ?? Date.now(),
      ...hashes,
    }),
  );
}

export async function forkEvaluationDataset(
  input: unknown,
  changes: {
    name?: string;
    binding?: EvaluationBinding;
    cases?: EvaluationCase[];
  },
  createdAt: number,
): Promise<EvaluationDataset> {
  const dataset = await importEvaluationDataset(input);
  if (dataset.status !== "frozen") throw Error("BLK-EVAL-DATASET-NOT-FROZEN");
  return createDatasetVersion({
    datasetId: dataset.datasetId,
    version: dataset.version + 1,
    name: changes.name ?? dataset.name,
    binding: changes.binding ?? dataset.binding,
    cases: changes.cases ?? dataset.cases,
    createdAt,
  });
}

export async function importEvaluationDataset(
  input: unknown,
): Promise<EvaluationDataset> {
  const dataset = requireValid(evaluationDatasetSchema.safeParse(input));
  if (dataset.status === "draft") return dataset;
  const actual = await expectedHashes(dataset);
  if (
    dataset.contentHash !== actual.contentHash ||
    dataset.bindingHash !== actual.bindingHash
  )
    throw Error("BLK-EVAL-HASH");
  return dataset;
}

export function evaluationDatasetKey(
  dataset: Pick<EvaluationDataset, "datasetId" | "version">,
) {
  return `${dataset.datasetId}:v${dataset.version}`;
}

export async function saveEvaluationAsset(
  store: EvaluationAssetStore,
  kind: EvaluationAssetKind,
  input: unknown,
  expectedRevision: number | null,
): Promise<EvaluationStoredAsset> {
  let key: string;
  let value: EvaluationDataset | EvaluationReport | EvaluationCheckpoint;
  if (kind === "dataset") {
    const dataset = await importEvaluationDataset(input);
    key = evaluationDatasetKey(dataset);
    value = dataset;
  } else if (kind === "report") {
    value = requireValid(evaluationReportSchema.safeParse(input));
    key = value.reportId;
  } else {
    value = requireValid(evaluationCheckpointSchema.safeParse(input));
    key = value.checkpointId;
  }

  const current = await store.read(kind, key);
  if ((current?.revision ?? null) !== expectedRevision)
    throw Error("BLK-EVAL-CAS");
  if (
    kind === "dataset" &&
    current?.kind === "dataset" &&
    current.value.status === "frozen"
  )
    throw Error("BLK-EVAL-FROZEN");
  return store.compareAndSwap(kind, key, expectedRevision, value);
}

export async function assertFrozenDataset(
  input: unknown,
): Promise<EvaluationDataset> {
  const dataset = await importEvaluationDataset(input);
  if (dataset.status !== "frozen") throw Error("BLK-EVAL-DATASET-NOT-FROZEN");
  return dataset;
}
