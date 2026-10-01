import { useEffect, useRef, useState } from "react";
import type { Project } from "@blocky/language-schema";
import {
  compareEvaluationReports,
  createEvaluationDataset,
  evaluationCheckpointSchema,
  evaluationReportSchema,
  forkEvaluationDataset,
  freezeEvaluationDataset,
  importEvaluationDataset,
  runEvaluation,
  saveEvaluationAsset,
  type EvaluationAssetStore,
  type EvaluationAssetKind,
  type EvaluationAssetMetadata,
  type EvaluationBinding,
  type EvaluationCheckpointReference,
  type EvaluationDataset,
  type EvaluationModelBinding,
  type EvaluationReport,
  type EvaluationRunResult,
} from "@blocky/runtime-core";
import { projectDigest } from "@blocky/project-model";

export type EvaluationPanelProps = {
  project: Project;
  model: EvaluationModelBinding;
  bindingHash: string;
  store: EvaluationAssetStore;
  execute: (
    testCase: EvaluationDataset["cases"][number],
    context: {
      signal: AbortSignal;
      candidate: {
        id: string;
        version: string;
        contentHash: string;
      };
      binding: EvaluationBinding;
    },
  ) => Promise<EvaluationRunResult>;
};

function codeFor(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^BLK-[A-Z0-9-]{3,64}$/.test(message) ? message : "BLK-EVAL-OPERATION";
}

function sameBinding(left: EvaluationBinding, right: EvaluationBinding) {
  return (
    left.configurationHash === right.configurationHash &&
    left.model.resourceId === right.model.resourceId &&
    left.model.provider === right.model.provider &&
    left.model.modelId === right.model.modelId &&
    left.model.version === right.model.version
  );
}

function newId() {
  return `evaluation-${crypto.randomUUID()}`;
}

export function EvaluationPanel({
  project,
  model,
  bindingHash,
  store,
  execute,
}: EvaluationPanelProps) {
  const projectId = project.manifest.projectId;
  const modelResourceId = model.resourceId;
  const modelProvider = model.provider;
  const modelId = model.modelId;
  const modelVersion = model.version;
  const binding: EvaluationBinding = {
    configurationHash: bindingHash,
    model: {
      resourceId: modelResourceId,
      provider: modelProvider,
      modelId,
      version: modelVersion,
    },
  };
  const pending = useRef<AbortController | null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort();};},[]);
  const epoch = useRef(0);
  const latestCheckpoint = useRef<EvaluationCheckpointReference | null>(null);
  const [datasetJson, setDatasetJson] = useState("");
  const [dataset, setDataset] = useState<EvaluationDataset | null>(null);
  const [reports, setReports] = useState<EvaluationReport[]>([]);
  const [savedAssets, setSavedAssets] = useState<
    Record<EvaluationAssetKind, EvaluationAssetMetadata[]>
  >({ dataset: [], report: [], checkpoint: [] });
  const [selectedAssets, setSelectedAssets] = useState<
    Record<EvaluationAssetKind, string>
  >({ dataset: "", report: "", checkpoint: "" });
  const [compareFirst, setCompareFirst] = useState("");
  const [compareSecond, setCompareSecond] = useState("");
  const [comparison, setComparison] = useState("");
  const [status, setStatus] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const current = ++epoch.current;
    pending.current?.abort();
    latestCheckpoint.current = null;
    setDatasetJson("");
    setDataset(null);
    setReports([]);
    setSavedAssets({ dataset: [], report: [], checkpoint: [] });
    setSelectedAssets({ dataset: "", report: "", checkpoint: "" });
    setCompareFirst("");
    setCompareSecond("");
    setComparison("");
    setStatus("");
    setErrorCode("");
    setBusy(pending.current!==null);
    return () => {
      if (epoch.current === current) epoch.current++;
      pending.current?.abort();
      latestCheckpoint.current = null;
    };
  }, [
    projectId,
    bindingHash,
    modelResourceId,
    modelProvider,
    modelId,
    modelVersion,
    store,
    execute,
  ]);

  const perform = async (
    work: (signal: AbortSignal, currentEpoch: number) => Promise<void>,
  ) => {
    if (pending.current) return;
    const controller = new AbortController();
    const currentEpoch = epoch.current;
    pending.current = controller;
    setBusy(true);
    setErrorCode("");
    try {
      await work(controller.signal, currentEpoch);
    } catch (error) {
      if (currentEpoch === epoch.current)
        setErrorCode(
          controller.signal.aborted ? "BLK-EVAL-CANCELLED" : codeFor(error),
        );
    } finally {
      if (pending.current === controller) pending.current = null;
      if (mounted.current) setBusy(false);
    }
  };

  const importDataset = () =>
    void perform(async (_signal, currentEpoch) => {
      let raw: unknown;
      try {
        raw = JSON.parse(datasetJson);
      } catch {
        throw Error("BLK-EVAL-DATASET-JSON");
      }
      const imported = await importEvaluationDataset(raw);
      if (!sameBinding(imported.binding, binding))
        throw Error("BLK-EVAL-MODEL-BINDING");
      if (currentEpoch !== epoch.current) return;
      latestCheckpoint.current = null;
      setReports([]);
      setDataset(imported);
      setStatus(
        imported.status === "frozen"
          ? `已导入冻结版本 v${imported.version}`
          : `已导入草稿 v${imported.version}`,
      );
    });

  const createDatasetDraft = () => {
    const draft = createEvaluationDataset({
      datasetId: newId(),
      name: "新建评估集",
      binding,
      createdAt: Date.now(),
      cases: [{ caseId: newId(), input: "" }],
    });
    latestCheckpoint.current = null;
    setDataset(null);
    setDatasetJson(JSON.stringify(draft, null, 2));
    setStatus("已生成当前模型绑定的草稿 JSON；编辑后导入并冻结");
    setErrorCode("");
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setErrorCode("BLK-EVAL-FILE-TOO-LARGE");
      return;
    }
    const currentEpoch = epoch.current;
    void file
      .text()
      .then((text) => {
        if (currentEpoch === epoch.current) setDatasetJson(text);
      })
      .catch(() => {
        if (currentEpoch === epoch.current)
          setErrorCode("BLK-EVAL-DATASET-JSON");
      });
  };

  const refreshSavedAssets = () =>
    void perform(async (signal, currentEpoch) => {
      if (!store.list) throw Error("BLK-EVAL-ASSET-LIST-UNAVAILABLE");
      const kinds: EvaluationAssetKind[] = ["dataset", "report", "checkpoint"];
      const listed = await Promise.all(
        kinds.map(async (kind) => {
          const entries = await store.list!(kind);
          if (!Array.isArray(entries)) throw Error("BLK-EVAL-SCHEMA");
          return [
            kind,
            entries.filter(
              (item) =>
                item.kind === kind &&
                typeof item.key === "string" &&
                item.key.length > 0 &&
                item.key.length <= 256 &&
                Number.isSafeInteger(item.revision) &&
                item.revision >= 0,
            ),
          ] as const;
        }),
      );
      signal.throwIfAborted();
      if (currentEpoch !== epoch.current) return;
      const next = Object.fromEntries(listed) as Record<
        EvaluationAssetKind,
        EvaluationAssetMetadata[]
      >;
      setSavedAssets(next);
      setSelectedAssets((current) => ({
        dataset: next.dataset.some((item) => item.key === current.dataset)
          ? current.dataset
          : (next.dataset[0]?.key ?? ""),
        report: next.report.some((item) => item.key === current.report)
          ? current.report
          : (next.report[0]?.key ?? ""),
        checkpoint: next.checkpoint.some(
          (item) => item.key === current.checkpoint,
        )
          ? current.checkpoint
          : (next.checkpoint[0]?.key ?? ""),
      }));
      setStatus("已刷新已保存评估资产");
    });

  const loadSavedDataset = () =>
    void perform(async (signal, currentEpoch) => {
      const key = selectedAssets.dataset;
      if (!key) throw Error("BLK-EVAL-ASSET-NOT-FOUND");
      const stored = await store.read("dataset", key);
      if (!stored || stored.kind !== "dataset" || stored.key !== key)
        throw Error("BLK-EVAL-ASSET-NOT-FOUND");
      const listed = savedAssets.dataset.find((item) => item.key === key);
      if (
        (listed && listed.revision !== stored.revision) ||
        !Number.isSafeInteger(stored.revision) ||
        stored.revision < 0
      )
        throw Error("BLK-EVAL-ASSET-STALE");
      const loaded = await importEvaluationDataset(stored.value);
      if (`${loaded.datasetId}:v${loaded.version}` !== key)
        throw Error("BLK-EVAL-SCHEMA");
      signal.throwIfAborted();
      if (currentEpoch !== epoch.current) return;
      latestCheckpoint.current = null;
      setDataset(loaded);
      setDatasetJson(JSON.stringify(loaded, null, 2));
      setStatus(sameBinding(loaded.binding,binding)?`已加载并校验评估集 v${loaded.version}`:`已加载历史评估集 v${loaded.version}；请创建新版本绑定当前配置后运行。`);
    });

  const loadSavedReport = () =>
    void perform(async (signal, currentEpoch) => {
      const key = selectedAssets.report;
      if (!key) throw Error("BLK-EVAL-ASSET-NOT-FOUND");
      const stored = await store.read("report", key);
      if (!stored || stored.kind !== "report" || stored.key !== key)
        throw Error("BLK-EVAL-ASSET-NOT-FOUND");
      const listed = savedAssets.report.find((item) => item.key === key);
      if (
        (listed && listed.revision !== stored.revision) ||
        !Number.isSafeInteger(stored.revision) ||
        stored.revision < 0
      )
        throw Error("BLK-EVAL-ASSET-STALE");
      const report = evaluationReportSchema.parse(stored.value);
      if (report.reportId !== key) throw Error("BLK-EVAL-SCHEMA");
      signal.throwIfAborted();
      if (currentEpoch !== epoch.current) return;
      setCompareSecond(JSON.stringify(report, null, 2));
      setStatus(`已加载并校验报告 ${report.reportId}，可与基准报告比较`);
    });

  const loadSavedCheckpoint = () =>
    void perform(async (signal, currentEpoch) => {
      const key = selectedAssets.checkpoint;
      if (!key) throw Error("BLK-EVAL-ASSET-NOT-FOUND");
      const listed = savedAssets.checkpoint.find((item) => item.key === key);
      const stored = await store.read("checkpoint", key);
      if (
        !stored ||
        stored.kind !== "checkpoint" ||
        stored.key !== key ||
        (listed && stored.revision !== listed.revision)
      )
        throw Error("BLK-EVAL-ASSET-STALE");
      const checkpoint = evaluationCheckpointSchema.parse(stored.value);
      if (checkpoint.checkpointId !== key) throw Error("BLK-EVAL-SCHEMA");
      if (!dataset || dataset.status !== "frozen")
        throw Error("BLK-EVAL-DATASET-NOT-FROZEN");
      const candidateHash = await projectDigest(project);
      signal.throwIfAborted();
      if (
        checkpoint.datasetId !== dataset.datasetId ||
        checkpoint.datasetVersion !== dataset.version ||
        checkpoint.datasetContentHash !== dataset.contentHash ||
        !sameBinding(checkpoint.binding, binding) ||
        checkpoint.candidate.id !== projectId ||
        checkpoint.candidate.version !== candidateHash ||
        checkpoint.candidate.contentHash !== candidateHash ||
        checkpoint.status === "completed"
      )
        throw Error("BLK-EVAL-CHECKPOINT-BINDING");
      if (currentEpoch !== epoch.current) return;
      latestCheckpoint.current = {
        value: checkpoint,
        revision: stored.revision,
      };
      setStatus(
        `已加载可继续检查点 ${checkpoint.checkpointId} · 存储修订 ${stored.revision}`,
      );
    });

  const freezeAndSave = () =>
    void perform(async (_signal, currentEpoch) => {
      if (!dataset || !sameBinding(dataset.binding, binding))
        throw Error("BLK-EVAL-MODEL-BINDING");
      const frozen =
        dataset.status === "frozen"
          ? dataset
          : await freezeEvaluationDataset(dataset);
      const key = `${frozen.datasetId}:v${frozen.version}`;
      const existing = await store.read("dataset", key);
      if (existing?.kind === "dataset") {
        if (
          existing.value.contentHash !== frozen.contentHash ||
          !sameBinding(existing.value.binding, frozen.binding)
        )
          throw Error("BLK-EVAL-CAS");
      } else {
        await saveEvaluationAsset(store, "dataset", frozen, null);
      }
      if (currentEpoch !== epoch.current) return;
      setDataset(frozen);
      setDatasetJson(JSON.stringify(frozen, null, 2));
      setStatus(`已冻结并保存 v${frozen.version} · ${frozen.cases.length} 行`);
    });

  const forkVersion = () => {
    if (!dataset || dataset.status !== "frozen" || busy) return;
    void forkEvaluationDataset(dataset, {binding}, Date.now())
      .then((draft) => {
        latestCheckpoint.current = null;
        setReports([]);
        setDataset(draft);
        setDatasetJson(JSON.stringify(draft, null, 2));
        setStatus(`已创建草稿 v${draft.version}；冻结后保存为新版本`);
      })
      .catch((error: unknown) => setErrorCode(codeFor(error)));
  };

  const startBatch = (resume: boolean) =>
    void perform(async (signal, currentEpoch) => {
      if (!dataset || dataset.status !== "frozen")
        throw Error("BLK-EVAL-DATASET-NOT-FROZEN");
      if (!sameBinding(dataset.binding, binding))
        throw Error("BLK-EVAL-MODEL-BINDING");
      const candidateHash = await projectDigest(project);
      signal.throwIfAborted();
      const prior = latestCheckpoint.current;
      if (resume && (!prior || prior.value.status === "completed"))
        throw Error("BLK-EVAL-CHECKPOINT-NOT-RESUMABLE");
      const candidate = {
        id: projectId,
        version: candidateHash,
        contentHash: candidateHash,
      };
      const checkpointId = resume && prior ? prior.value.checkpointId : newId();
      const reportId = resume && prior ? prior.value.reportId : newId();
      const result = await runEvaluation({
        dataset,
        candidate,
        checkpointId,
        reportId,
        store,
        execute,
        signal,
        resultDetailPolicy: "summary",
        ...(resume && prior ? { checkpoint: prior } : {}),
      });
      if (currentEpoch !== epoch.current) return;
      latestCheckpoint.current = result.checkpoint;
      setReports((current) => [
        result.report,
        ...current.filter(
          (report) => report.reportId !== result.report.reportId,
        ),
      ]);
      setCompareFirst(JSON.stringify(result.report, null, 2));
      setStatus(
        result.report.status === "completed"
          ? `批次完成 · ${result.report.rows.length} 行`
          : `批次已保存 · ${result.report.rows.length} 行；可继续未完成项目`,
      );
    });

  const compareReports = () => {
    try {
      const first: unknown = JSON.parse(compareFirst);
      const second: unknown = JSON.parse(compareSecond);
      const checkedFirst = evaluationReportSchema.parse(first);
      const checkedSecond = evaluationReportSchema.parse(second);
      setComparison(
        JSON.stringify(
          compareEvaluationReports(checkedFirst, checkedSecond),
          null,
          2,
        ),
      );
      setErrorCode("");
    } catch (error) {
      setComparison("");
      setErrorCode(codeFor(error));
    }
  };

  return (
    <section className="evaluation-panel" aria-label="评估集与批次">
      <h3>评估集与批次</h3>
      <label>
        评估集 JSON
        <textarea
          aria-label="评估集 JSON"
          value={datasetJson}
          disabled={busy}
          onChange={(event) => setDatasetJson(event.target.value)}
        />
      </label>
      <div>
        <button disabled={busy} onClick={createDatasetDraft}>
          新建评估集
        </button>
      </div>
      <div>
        <label>
          导入评估集文件
          <input
            aria-label="导入评估集文件"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => readFile(event.currentTarget.files?.[0])}
          />
        </label>
        <button disabled={busy || !datasetJson.trim()} onClick={importDataset}>
          导入评估集
        </button>
        <button
          disabled={busy || !dataset}
          onClick={freezeAndSave}
          title="冻结后内容和模型绑定不可变"
        >
          冻结并保存版本
        </button>
        <button
          disabled={busy || dataset?.status !== "frozen"}
          onClick={forkVersion}
        >
          创建下一版本
        </button>
      </div>
      {store.list && (
        <section aria-label="已保存评估资产">
          <button disabled={busy} onClick={refreshSavedAssets}>
            刷新已保存资产
          </button>
          <label>
            已保存评估集
            <select
              aria-label="已保存评估集"
              value={selectedAssets.dataset}
              disabled={busy}
              onChange={(event) =>
                setSelectedAssets((current) => ({
                  ...current,
                  dataset: event.target.value,
                }))
              }
            >
              <option value="">选择评估集</option>
              {savedAssets.dataset.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key} · r{item.revision}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !selectedAssets.dataset}
            onClick={loadSavedDataset}
          >
            加载评估集
          </button>
          <label>
            已保存报告
            <select
              aria-label="已保存报告"
              value={selectedAssets.report}
              disabled={busy}
              onChange={(event) =>
                setSelectedAssets((current) => ({
                  ...current,
                  report: event.target.value,
                }))
              }
            >
              <option value="">选择报告</option>
              {savedAssets.report.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key} · r{item.revision}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !selectedAssets.report}
            onClick={loadSavedReport}
          >
            加载报告
          </button>
          <label>
            已保存检查点
            <select
              aria-label="已保存检查点"
              value={selectedAssets.checkpoint}
              disabled={busy}
              onChange={(event) =>
                setSelectedAssets((current) => ({
                  ...current,
                  checkpoint: event.target.value,
                }))
              }
            >
              <option value="">选择检查点</option>
              {savedAssets.checkpoint.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key} · r{item.revision}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !selectedAssets.checkpoint}
            onClick={loadSavedCheckpoint}
          >
            加载检查点
          </button>
        </section>
      )}
      {dataset && (
        <p role="status">
          {dataset.name} · v{dataset.version} · {dataset.cases.length} 行 ·{" "}
          {dataset.status === "frozen" ? "已冻结" : "草稿"}
        </p>
      )}
      <div>
        <button
          disabled={busy || !dataset || dataset.status !== "frozen"}
          onClick={() => startBatch(false)}
        >
          创建批次
        </button>
        <button
          disabled={
            busy ||
            !latestCheckpoint.current ||
            latestCheckpoint.current.value.status === "completed"
          }
          onClick={() => startBatch(true)}
        >
          继续未完成批次
        </button>
        {busy && (
          <button onClick={() => pending.current?.abort()}>取消批次</button>
        )}
      </div>
      {status && <p role="status">{status}</p>}
      {errorCode && <p role="alert">{errorCode}</p>}
      {reports.map((report) => (
        <section key={report.reportId} aria-label={`批次 ${report.reportId}`}>
          <h4>{report.status === "completed" ? "已完成批次" : "部分批次"}</h4>
          <p>
            {report.metrics.cases.completed} 完成 ·{" "}
            {report.metrics.cases.failed} 失败 ·{" "}
            {report.metrics.cases.uncertain} 结果不确定
          </p>
          <table>
            <thead>
              <tr>
                <th>行 ID</th>
                <th>状态</th>
                <th>检查</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.caseId}>
                  <td>{row.caseId}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.passed === null
                      ? "未评分"
                      : row.passed
                        ? "通过"
                        : "未通过"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <section aria-label="比较报告">
        <h4>比较报告 JSON</h4>
        <label>
          基准报告
          <textarea
            aria-label="基准报告 JSON"
            value={compareFirst}
            disabled={busy}
            onChange={(event) => setCompareFirst(event.target.value)}
          />
        </label>
        <label>
          对照报告
          <textarea
            aria-label="对照报告 JSON"
            value={compareSecond}
            disabled={busy}
            onChange={(event) => setCompareSecond(event.target.value)}
          />
        </label>
        <button
          disabled={busy || !compareFirst.trim() || !compareSecond.trim()}
          onClick={compareReports}
        >
          比较报告
        </button>
        {comparison && <pre aria-label="报告差异">{comparison}</pre>}
      </section>
    </section>
  );
}
