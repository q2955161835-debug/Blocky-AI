import { randomUUID } from "node:crypto";
import { canonicalJson, type Json } from "@blocky/language-schema";
import {
  compareEvaluationReports,
  evaluationDatasetKey,
  evaluationReportSchema,
  freezeEvaluationDataset,
  importEvaluationDataset,
  NativeEvaluationStore,
  saveEvaluationAsset,
  type EvaluationAssetKind,
  type EvaluationDataset,
  type NativeEvaluationPort,
} from "@blocky/runtime-core";
import { allow, required, type Args } from "./arguments";
import { readJsonArtifact } from "./artifacts";
import { CliError, envelope } from "./protocol";
import { readProject } from "./native-store";

export const evaluationHelp = [
  "evaluation import <file.blocky> --input <dataset.json> --json",
  "evaluation freeze <file.blocky> --input <dataset.json> --json",
  "evaluation list <file.blocky> --kind <dataset|report|checkpoint> --json",
  "evaluation read <file.blocky> --kind <dataset|report|checkpoint> --key <key> --json",
  "evaluation compare --first <report.json> --second <report.json> --json",
];

const kinds = ["dataset", "report", "checkpoint"] as const;
function assetKind(value: string): EvaluationAssetKind {
  if ((kinds as readonly string[]).includes(value))
    return value as EvaluationAssetKind;
  throw new CliError(2, "BLK-CLI-002", "评估资产类型无效。");
}

function requirePort(
  port: NativeEvaluationPort | undefined,
): NativeEvaluationPort {
  if (!port)
    throw new CliError(
      6,
      "BLK-EVAL-HOST-UNAVAILABLE",
      "评估 Host 通道未连接。",
      "使用包含评估原生通道的 Blocky CLI。",
    );
  return port;
}

async function saveDataset(
  store: NativeEvaluationStore,
  dataset: EvaluationDataset,
) {
  const key = evaluationDatasetKey(dataset);
  const current = await store.read("dataset", key);
  if (current?.kind === "dataset") {
    if (
      canonicalJson(current.value as unknown as Json) !==
      canonicalJson(dataset as unknown as Json)
    )
      throw Error("BLK-EVAL-CAS");
    return current;
  }
  return saveEvaluationAsset(store, "dataset", dataset, null);
}

/** The Host approval flow is supplied by nativeAgentServices by the caller. */
export async function evaluationCommand(
  args: Args,
  signal: AbortSignal,
  port?: NativeEvaluationPort,
) {
  if (args.words[0] !== "evaluation") return;
  const action = args.words[1];
  if (!evaluationHelp.some((line) => line.startsWith(`evaluation ${action} `)))
    throw new CliError(2, "BLK-CLI-002", "评估命令不存在。");

  if (action === "compare") {
    allow(args, ["first", "second", "json"], 2);
    const [firstRaw, secondRaw] = await Promise.all([
      readJsonArtifact(required(args, "first"), 8 * 1024 * 1024),
      readJsonArtifact(required(args, "second"), 8 * 1024 * 1024),
    ]);
    const first = evaluationReportSchema.safeParse(firstRaw);
    const second = evaluationReportSchema.safeParse(secondRaw);
    if (!first.success || !second.success)
      throw new CliError(3, "BLK-EVAL-REPORT-INVALID", "评估报告格式无效。");
    return {
      code: 0,
      result: envelope(
        "evaluation.compare",
        compareEvaluationReports(first.data, second.data),
      ),
    };
  }

  allow(
    args,
    action === "import" || action === "freeze"
      ? ["input", "json"]
      : action === "list"
        ? ["kind", "json"]
        : ["kind", "key", "json"],
    3,
  );
  signal.throwIfAborted();
  const project = await readProject(args.words[2]!);
  const nativePort = requirePort(port);
  const sessionId = `evaluation-cli-${randomUUID()}`;
  const store = new NativeEvaluationStore(
    nativePort,
    project.manifest.projectId,
    sessionId,
    signal,
  );

  if (action === "import" || action === "freeze") {
    const imported = await importEvaluationDataset(
      await readJsonArtifact(required(args, "input"), 8 * 1024 * 1024),
    );
    const dataset =
      action === "freeze" ? await freezeEvaluationDataset(imported) : imported;
    signal.throwIfAborted();
    const saved = await saveDataset(store, dataset);
    return {
      code: 0,
      result: envelope(`evaluation.${action}`, {
        projectId: project.manifest.projectId,
        datasetId: dataset.datasetId,
        version: dataset.version,
        key: saved.key,
        revision: saved.revision,
        status: dataset.status,
        contentHash: dataset.contentHash ?? null,
      }),
    };
  }

  const kind = assetKind(required(args, "kind"));
  if (action === "list") {
    return {
      code: 0,
      result: envelope("evaluation.list", {
        projectId: project.manifest.projectId,
        assets: await store.list(kind),
      }),
    };
  }

  const key = required(args, "key");
  const asset = await store.read(kind, key);
  return {
    code: 0,
    result: envelope("evaluation.read", {
      projectId: project.manifest.projectId,
      asset,
    }),
  };
}
