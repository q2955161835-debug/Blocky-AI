import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createEvaluationDataset,
  freezeEvaluationDataset,
  runEvaluation,
  type EvaluationAssetStore,
  type EvaluationStoredAsset,
} from "../../packages/runtime-core/src/evaluation";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { writeJsonArtifact } from "../../tools/blocky-cli/src/artifacts";
import { evaluationCommand } from "../../tools/blocky-cli/src/evaluation";

let directory = "";
afterEach(async () => {
  if (directory && resolve(directory).startsWith(resolve("try") + "\\"))
    await rm(directory, { recursive: true, force: true });
  directory = "";
});

class MemoryStore implements EvaluationAssetStore {
  private values = new Map<string, EvaluationStoredAsset>();

  async read(kind: EvaluationStoredAsset["kind"], key: string) {
    return this.values.get(`${kind}:${key}`) ?? null;
  }

  async compareAndSwap(
    kind: EvaluationStoredAsset["kind"],
    key: string,
    expectedRevision: number | null,
    value: EvaluationStoredAsset["value"],
  ) {
    const id = `${kind}:${key}`;
    const current = this.values.get(id);
    if ((current?.revision ?? null) !== expectedRevision)
      throw Error("BLK-EVAL-CAS");
    const next = {
      kind,
      key,
      revision: (current?.revision ?? 0) + 1,
      value,
    } as EvaluationStoredAsset;
    this.values.set(id, next);
    return next;
  }
}

describe("evaluation CLI domain", () => {
  it("compares two saved reports using their frozen dataset identity", async () => {
    directory = await mkdtemp(resolve("try/evaluation-cli-"));
    const binding = {
      configurationHash: "a".repeat(64),
      model: {
        resourceId: "model-local",
        provider: "local",
        modelId: "answer-model",
        version: "1.0",
      },
    };
    const dataset = await freezeEvaluationDataset(
      createEvaluationDataset({
        datasetId: "support-cases",
        name: "Support cases",
        binding,
        createdAt: 1,
        cases: [
          {
            caseId: "case-one",
            input: "question",
            expected: { answer: "answer" },
          },
        ],
      }),
      2,
    );
    const makeReport = (version: string, suffix: string) =>
      runEvaluation({
        dataset,
        candidate: {
          id: "project-main",
          version,
          contentHash: version === "v1" ? "b".repeat(64) : "c".repeat(64),
        },
        checkpointId: `checkpoint-${suffix}`,
        reportId: `report-${suffix}`,
        store: new MemoryStore(),
        execute: async () => ({ status: "completed", answer: "answer" }),
      });
    const first = await makeReport("v1", "one");
    const second = await makeReport("v2", "two");
    const firstPath = join(directory, "first.json");
    const secondPath = join(directory, "second.json");
    await writeJsonArtifact(firstPath, first.report);
    await writeJsonArtifact(secondPath, second.report);

    const result = await evaluationCommand(
      parse([
        "evaluation",
        "compare",
        "--first",
        firstPath,
        "--second",
        secondPath,
        "--json",
      ]),
      new AbortController().signal,
    );

    expect(result?.code).toBe(0);
    expect(result?.result.data).toMatchObject({
      schemaVersion: "blocky.evaluation-comparison/v1",
      candidateVersions: ["v1", "v2"],
      changedCaseIds: [],
    });
  });
});
