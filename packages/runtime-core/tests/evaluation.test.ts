import { describe, expect, it } from "vitest";
import type { Json } from "@blocky/language-schema";
import * as evaluationModule from "../src/evaluation";
import {
  createEvaluationDataset,
  freezeEvaluationDataset,
  forkEvaluationDataset,
  importEvaluationDataset,
  saveEvaluationAsset,
  runEvaluation,
  compareEvaluationReports,
  addEvaluationHumanRating,
  EvaluationRunnerError,
  type EvaluationAssetStore,
  type EvaluationRunResult,
  type EvaluationStoredAsset,
} from "../src/evaluation";

const binding = {
  configurationHash: "a".repeat(64),
  model: {
    resourceId: "model-main",
    provider: "local",
    modelId: "answer-model",
    version: "2.1.0",
  },
};

describe("native evaluation asset bridge", () => {
  it("exports a Host-backed store for durable evaluation state", () => {
    expect(evaluationModule).toHaveProperty("NativeEvaluationStore");
    expect(evaluationModule).toHaveProperty("evaluationAssetRequestSchema");
  });

  it("sends bounded, project-scoped requests and validates Host replies", async () => {
    type Port = (payload: unknown, signal?: AbortSignal) => Promise<Json>;
    type Constructor = new (
      port: Port,
      projectId: string,
      sessionId: string,
      signal: AbortSignal,
    ) => EvaluationAssetStore & {
      list(kind: EvaluationStoredAsset["kind"]): Promise<unknown>;
    };
    const NativeEvaluationStore = (
      evaluationModule as unknown as { NativeEvaluationStore: Constructor }
    ).NativeEvaluationStore;
    const seen: { payload: unknown; signal?: AbortSignal }[] = [];
    const expectedSignal = new AbortController().signal;
    const dataset = await makeDataset();
    const port: Port = async (payload, signal): Promise<Json> => {
      seen.push({ payload, signal });
      const request = payload as { action: string; kind: string; key?: string };
      if (request.action === "read") return null;
      if (request.action === "cas" && request.key)
        return {
          kind: request.kind,
          key: request.key,
          revision: 1,
          value: dataset,
        } as unknown as Json;
      return { assets: [] };
    };
    const store = new NativeEvaluationStore(
      port,
      "project-main",
      "session-main",
      expectedSignal,
    );

    expect(await store.read("dataset", "support-cases:v1")).toBeNull();
    const stored = await store.compareAndSwap(
      "dataset",
      "support-cases:v1",
      null,
      dataset,
    );
    expect(stored.revision).toBe(1);
    await store.list("dataset");

    for (const call of seen) {
      const request = call.payload as Record<string, unknown>;
      expect(request).toMatchObject({
        schemaVersion: "blocky.evaluation-asset-request/v1",
        projectId: "project-main",
        sessionId: "session-main",
      });
      expect(request.requestId).toMatch(/^evaluation-[0-9a-f-]{36}$/i);
      expect(call.signal).toBe(expectedSignal);
    }
    expect(seen[2]?.payload).not.toHaveProperty("key");
    expect(seen[2]?.payload).not.toHaveProperty("value");
  });

  it("rejects Host replies that do not match the requested asset", async () => {
    type Port = (payload: unknown, signal?: AbortSignal) => Promise<Json>;
    type Constructor = new (
      port: Port,
      projectId: string,
      sessionId: string,
      signal: AbortSignal,
    ) => EvaluationAssetStore;
    const NativeEvaluationStore = (
      evaluationModule as unknown as { NativeEvaluationStore: Constructor }
    ).NativeEvaluationStore;
    const store = new NativeEvaluationStore(
      async () => ({
        kind: "report",
        key: "support-cases:v1",
        revision: 1,
        value: {},
      }),
      "project-main",
      "session-main",
      new AbortController().signal,
    );

    await expect(store.read("dataset", "support-cases:v1")).rejects.toThrow(
      "BLK-EVAL-HOST-RESPONSE",
    );
  });

  it("keeps asset listing metadata-only", async () => {
    type Port = (payload: unknown, signal?: AbortSignal) => Promise<Json>;
    type Constructor = new (
      port: Port,
      projectId: string,
      sessionId: string,
      signal: AbortSignal,
    ) => EvaluationAssetStore & {
      list(kind: EvaluationStoredAsset["kind"]): Promise<unknown>;
    };
    const NativeEvaluationStore = (
      evaluationModule as unknown as { NativeEvaluationStore: Constructor }
    ).NativeEvaluationStore;
    const store = new NativeEvaluationStore(
      async () => ({
        assets: [
          {
            kind: "dataset",
            key: "support-cases:v1",
            revision: 1,
            value: { input: "must not be returned" },
          },
        ],
      }),
      "project-main",
      "session-main",
      new AbortController().signal,
    );

    await expect(store.list("dataset")).rejects.toThrow(
      "BLK-EVAL-HOST-RESPONSE",
    );
  });

  it("rejects undeclared fields and keys on list requests", () => {
    const requestSchema = (
      evaluationModule as unknown as {
        evaluationAssetRequestSchema: {
          safeParse(value: unknown): { success: boolean };
        };
      }
    ).evaluationAssetRequestSchema;
    const base = {
      schemaVersion: "blocky.evaluation-asset-request/v1",
      requestId: "evaluation-29fc7c83-26a7-43a4-b12b-a6c57e55b0a3",
      projectId: "project-main",
      sessionId: "session-main",
    };

    expect(
      requestSchema.safeParse({
        ...base,
        action: "read",
        kind: "dataset",
        key: "support-cases:v1",
        expectedRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      requestSchema.safeParse({
        ...base,
        action: "list",
        kind: "dataset",
        key: "support-cases:v1",
      }).success,
    ).toBe(false);
  });
});

const makeDataset = async (id = "support-cases") =>
  freezeEvaluationDataset(
    createEvaluationDataset({
      datasetId: id,
      name: "Support cases",
      binding,
      createdAt: 10,
      cases: [
        {
          caseId: "case-one",
          input: "Where is the guide?",
          expected: {
            answer: "See the guide.",
            structured: { answer: "See the guide." },
            citationIds: ["doc-1"],
            retrievalHitIds: ["doc-1"],
          },
        },
        {
          caseId: "case-two",
          input: { question: "How many?" },
          expected: { structured: { count: 2 } },
        },
        {
          caseId: "case-three",
          input: "Repeat the count.",
          expected: { structured: { count: 2 } },
        },
      ],
    }),
    20,
  );

class MemoryStore implements EvaluationAssetStore {
  private values = new Map<string, EvaluationStoredAsset>();

  async read(kind: EvaluationStoredAsset["kind"], key: string) {
    return this.values.get(`${kind}:${key}`) ?? null;
  }

  async compareAndSwap(
    kind: EvaluationStoredAsset["kind"],
    key: string,
    expectedRevision: number | null,
    value: unknown,
  ) {
    const storageKey = `${kind}:${key}`;
    const current = this.values.get(storageKey);
    if ((current?.revision ?? null) !== expectedRevision)
      throw Error("BLK-EVAL-CAS");
    const stored = {
      kind,
      key,
      revision: (current?.revision ?? 0) + 1,
      value,
    } as EvaluationStoredAsset;
    this.values.set(storageKey, stored);
    return stored;
  }

  delete(kind: EvaluationStoredAsset["kind"], key: string) {
    this.values.delete(`${kind}:${key}`);
  }
}

const result = (
  answer: string,
  structured: EvaluationRunResult["structured"],
  extra: Partial<EvaluationRunResult> = {},
): EvaluationRunResult => ({
  status: "completed",
  answer,
  structured,
  citations: [{ id: "doc-1", title: "Guide", text: "private source text" }],
  retrievalHitIds: ["doc-1"],
  generations: [
    {
      provider: "local",
      model: "answer-model",
      transport: "local",
      requestId: "request-1",
      text: answer,
      usage: null,
    },
  ],
  ...extra,
});

describe("evaluation assets", () => {
  it("freezes content by hash and edits into a new immutable version", async () => {
    const frozen = await makeDataset();
    const next = await forkEvaluationDataset(
      frozen,
      { name: "Support cases revised" },
      30,
    );

    expect(frozen.version).toBe(1);
    expect(frozen.status).toBe("frozen");
    expect(frozen.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(next.version).toBe(2);
    expect(next.status).toBe("draft");
    expect(next.contentHash).toBeUndefined();
    expect(frozen.name).toBe("Support cases");
  });

  it("imports only valid frozen hashes and refuses to overwrite a frozen version", async () => {
    const frozen = await makeDataset();
    expect(await importEvaluationDataset(frozen)).toEqual(frozen);
    await expect(
      importEvaluationDataset({ ...frozen, contentHash: "0".repeat(64) }),
    ).rejects.toThrow("BLK-EVAL-HASH");

    const store = new MemoryStore();
    await saveEvaluationAsset(store, "dataset", frozen, null);
    await expect(
      saveEvaluationAsset(store, "dataset", frozen, 1),
    ).rejects.toThrow("BLK-EVAL-FROZEN");
  });
});

describe("evaluation runs", () => {
  it("runs an injected runtime, scores expected outputs deterministically, and compares candidate versions", async () => {
    const dataset = await makeDataset();
    const store = new MemoryStore();
    let tick = 100;
    const execute = async ({ caseId }: { caseId: string }) =>
      caseId === "case-one"
        ? result("See the guide.", { answer: "See the guide." })
        : result("", { count: 2 }, { citations: [], retrievalHitIds: [] });

    const first = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "1.0",
        contentHash: "b".repeat(64),
      },
      checkpointId: "checkpoint-one",
      reportId: "report-one",
      store,
      now: () => ++tick,
      monotonicNow: (() => {
        let value = 0;
        return () => (value += 5);
      })(),
      execute,
    });

    expect(first.report.status).toBe("completed");
    expect(first.report.metrics.correctness).toEqual({
      scored: 3,
      passed: 3,
      accuracy: 1,
    });
    expect(first.report.metrics.citations).toEqual({
      scored: 1,
      passed: 1,
      accuracy: 1,
    });
    expect(first.report.metrics.retrieval).toEqual({
      scored: 1,
      passed: 1,
      accuracy: 1,
    });
    expect(first.report.metrics.usage).toEqual({
      status: "unavailable",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    expect(first.report.scoring.model.status).toBe("not-run");
    expect(first.report.rows[0]).not.toHaveProperty("answer");
    expect(first.report.rows[0]).not.toHaveProperty("structuredResult");
    expect(JSON.stringify(first.report)).not.toContain("private source text");

    const second = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "2.0",
        contentHash: "c".repeat(64),
      },
      checkpointId: "checkpoint-two",
      reportId: "report-two",
      store,
      execute: async ({ caseId }: { caseId: string }) =>
        caseId === "case-one"
          ? result("Wrong answer", { answer: "Wrong answer" })
          : result("", { count: 2 }, { citations: [], retrievalHitIds: [] }),
    });
    const comparison = compareEvaluationReports(first.report, second.report);
    expect(comparison.candidateVersions).toEqual(["1.0", "2.0"]);
    expect(comparison.accuracyDelta).toBeCloseTo(-1 / 3);
    expect(comparison.changedCaseIds).toEqual(["case-one"]);
  });

  it("cancels without replaying a started case whose side effects are unknown", async () => {
    const dataset = await makeDataset();
    const store = new MemoryStore();
    const controller = new AbortController();
    let releaseStarted: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const didStart = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let calls: string[] = [];

    const pending = runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "1.0",
        contentHash: "b".repeat(64),
      },
      checkpointId: "checkpoint-resume",
      reportId: "report-resume",
      store,
      signal: controller.signal,
      execute: async (
        { caseId }: { caseId: string },
        context: { signal: AbortSignal },
      ) => {
        calls.push(caseId);
        if (caseId === "case-two") {
          markStarted?.();
          await new Promise<void>((resolve) => {
            releaseStarted = resolve;
            context.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
        }
        return result("See the guide.", { answer: "See the guide." });
      },
    });

    await didStart;
    controller.abort();
    releaseStarted?.();
    const paused = await pending;
    expect(paused.checkpoint.value.status).toBe("cancelled");
    expect(paused.checkpoint.value.cases[1]?.status).toBe("uncertain");

    const resumed = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "1.0",
        contentHash: "b".repeat(64),
      },
      checkpointId: "checkpoint-resume",
      reportId: "report-resume",
      store,
      checkpoint: paused.checkpoint,
      execute: async ({ caseId }: { caseId: string }) => {
        calls.push(caseId);
        return caseId === "case-three"
          ? result("", { count: 2 }, { citations: [], retrievalHitIds: [] })
          : result("See the guide.", { answer: "See the guide." });
      },
    });
    expect(calls).toEqual(["case-one", "case-two", "case-three"]);
    expect(resumed.report.rows[1]?.status).toBe("uncertain");
    expect(resumed.report.rows[1]?.errorCode).toBe("BLK-EVAL-OUTCOME-UNKNOWN");
    expect(resumed.report.rows[2]?.status).toBe("completed");
    expect(resumed.report.status).toBe("completed");
  });

  it("records stable runner errors and keeps unknown usage as null", async () => {
    const dataset = await makeDataset();
    const store = new MemoryStore();
    const evaluated = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "2.1",
        contentHash: "f".repeat(64),
      },
      checkpointId: "checkpoint-errors",
      reportId: "report-errors",
      store,
      execute: async ({ caseId }) => {
        if (caseId === "case-one")
          throw new EvaluationRunnerError("BLK-TOOL-FAILED", "none");
        return result("", { count: 2 }, { citations: [], retrievalHitIds: [] });
      },
    });

    expect(evaluated.report.rows[0]?.status).toBe("failed");
    expect(evaluated.report.rows[0]?.errorCode).toBe("BLK-TOOL-FAILED");
    expect(evaluated.report.rows[0]?.checks.correctness).toBe(false);
    expect(evaluated.report.metrics.usage).toEqual({
      status: "unavailable",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  it("keeps model scores and human ratings separate from deterministic metrics", async () => {
    const dataset = await makeDataset();
    const store = new MemoryStore();
    const scorerBinding = {
      resourceId: "judge-resource",
      provider: "local",
      modelId: "judge-model",
      version: "4.0",
    };
    const scored = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "3.0",
        contentHash: "d".repeat(64),
      },
      checkpointId: "checkpoint-scoring",
      reportId: "report-scoring",
      store,
      execute: async ({ caseId }) =>
        caseId === "case-one"
          ? result("See the guide.", { answer: "See the guide." })
          : result("", { count: 2 }, { citations: [], retrievalHitIds: [] }),
      scorer: {
        binding: scorerBinding,
        score: async () => ({
          score: 0.8,
          binding: scorerBinding,
          generation: {
            provider: "local",
            model: "judge-model",
            transport: "local",
            requestId: "judge-request",
            text: "0.8",
            usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
          },
        }),
      },
    });

    expect(scored.report.scoring.model.status).toBe("completed");
    expect(scored.report.scoring.model.rows).toHaveLength(3);
    expect(scored.report.scoring.deterministic.correctness.accuracy).toBe(1);
    expect(scored.report.metrics.usage).toEqual({
      status: "unavailable",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    const rated = addEvaluationHumanRating(scored.report, {
      caseId: "case-one",
      score: 0.5,
      reviewerId: "reviewer-one",
      ratedAt: 500,
    });
    expect(rated.scoring.human).toHaveLength(1);
    expect(rated.scoring.model.rows).toEqual(scored.report.scoring.model.rows);
    expect(rated.scoring.deterministic).toEqual(
      scored.report.scoring.deterministic,
    );
  });

  it("includes structured results only when requested and redacts credential fields", async () => {
    const dataset = await makeDataset();
    const evaluated = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "5.0",
        contentHash: "9".repeat(64),
      },
      checkpointId: "checkpoint-structured",
      reportId: "report-structured",
      store: new MemoryStore(),
      resultDetailPolicy: "structured",
      execute: async ({ caseId }) =>
        caseId === "case-one"
          ? result("See the guide.", { answer: "See the guide." })
          : result(
              "",
              { count: 2, apiKey: "Bearer private-value" },
              { citations: [], retrievalHitIds: [] },
            ),
    });

    expect(evaluated.report.resultDetailPolicy).toBe("structured");
    expect(evaluated.report.rows[1]?.structuredResult).toEqual({
      count: 2,
      apiKey: "[已脱敏]",
    });
    expect(JSON.stringify(evaluated.report)).not.toContain("private-value");
    expect(evaluated.report.rows[1]).not.toHaveProperty("answer");
  });

  it("recreates a missing report from a completed checkpoint without rerunning work", async () => {
    const dataset = await makeDataset();
    const store = new MemoryStore();
    const completed = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "4.0",
        contentHash: "e".repeat(64),
      },
      checkpointId: "checkpoint-report-recovery",
      reportId: "report-recovery",
      store,
      execute: async ({ caseId }) =>
        caseId === "case-one"
          ? result("See the guide.", { answer: "See the guide." })
          : result("", { count: 2 }, { citations: [], retrievalHitIds: [] }),
    });
    store.delete("report", "report-recovery");

    const recovered = await runEvaluation({
      dataset,
      candidate: {
        id: "assistant",
        version: "4.0",
        contentHash: "e".repeat(64),
      },
      checkpointId: "checkpoint-report-recovery",
      reportId: "report-recovery",
      store,
      checkpoint: completed.checkpoint,
      execute: async () => {
        throw Error("Completed work must not run again");
      },
    });
    expect(recovered.report.status).toBe("completed");
    expect(recovered.report.rows).toHaveLength(3);
  });
});
