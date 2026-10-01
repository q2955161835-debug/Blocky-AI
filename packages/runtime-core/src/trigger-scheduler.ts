import { canonicalJson, type Json, type Project, type Resource } from "@blocky/language-schema";
import type { RuntimeEvent } from "@blocky/observability";
import type { RunResult, Runtime } from "./runtime";
import { compileProject } from "@blocky/compiler";
import { resolveRunEntry } from "./entry";
import {
  dueOccurrence,
  type TriggerConfig,
  type TriggerObservation,
  type TriggerOccurrence,
} from "./triggers";
import type { TriggerClient, TriggerRecord } from "./trigger-api";

export type TriggerRuntimeHandle = {
  project: Project;
  runtime: Pick<Runtime, "run">;
  userRegistry?: Map<string, import("@blocky/language-schema").Resource>;
  dispose(): void | Promise<void>;
};
export type TriggerOutcome =
  | { kind: "completed"; occurrence: TriggerOccurrence; record: TriggerRecord; result: RunResult }
  | { kind: "blocked"; reason: "unsettled-claim" | "uncertain-result"; occurrence: TriggerOccurrence; record: TriggerRecord; errorCode?: string; workflowTaskId?: string; result?: RunResult }
  | { kind: "rejected"; reason: "binding" | "target-not-durable"; errorCode: string }
  | { kind: "indeterminate"; occurrence: TriggerOccurrence; errorCode: string }
  | { kind: "duplicate"; occurrence: TriggerOccurrence; record: TriggerRecord }
  | { kind: "skipped"; reason: "not-found" | "disabled" | "not-timer" | "not-due"; config?: TriggerConfig };

type ObservationState = TriggerObservation & { revision: number };

function stableErrorCode(error: unknown, fallback = "BLK-TRIGGER-RUNTIME") {
  const message = error instanceof Error ? error.message : "";
  const code = /\b(BLK-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/u.exec(message)?.[1];
  return code && /^BLK-(?:[A-Z0-9]+-)*[A-Z0-9]+$/u.test(code) ? code : fallback;
}
function runErrorCode(result: RunResult) {
  const failed = [...result.events].reverse().find((event) => event.type === "run.failed");
  const code = failed?.data && typeof failed.data === "object" && "code" in failed.data
    ? failed.data.code
    : undefined;
  return typeof code === "string" && /^BLK-(?:[A-Z0-9]+-)*[A-Z0-9]+$/u.test(code)
    ? code
    : result.status === "cancelled" ? "BLK-RUN-005" : "BLK-TRIGGER-RUNTIME";
}

/**
 * Durable timer runner. The Host reserves the occurrence before a Runtime is
 * created; a reserved claim is never re-executed after an uncertain outcome.
 */
export class TriggerScheduler {
  private readonly observations = new Map<string, ObservationState>();
  private readonly usedRuntimes = new WeakSet<object>();
  private readonly processedExternal = new Set<string>();
  private readonly startedExternal = new Set<string>();
  private readonly discardedExternal = new Set<string>();
  private externalQueue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  readonly pollIntervalMs: number;

  constructor(private readonly options: {
    client: TriggerClient;
    createRuntime: (signal: AbortSignal) => TriggerRuntimeHandle | Promise<TriggerRuntimeHandle>;
    now?: () => number;
    pollIntervalMs?: number;
    onEvent?: (event: RuntimeEvent) => void;
  }) {
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 250 || this.pollIntervalMs > 60_000)
      throw Error("BLK-TRIGGER-POLL-INTERVAL");
  }

  async runDue(triggerId: string, signal: AbortSignal): Promise<TriggerOutcome> {
    signal.throwIfAborted();
    const config = await this.options.client.read(triggerId, signal);
    if (!config) return { kind: "skipped", reason: "not-found" };
    if (!config.enabled) return { kind: "skipped", reason: "disabled", config };
    if (config.type !== "timer") return { kind: "skipped", reason: "not-timer", config };

    const timestamp = this.now();
    const prior = this.observations.get(triggerId);
    const observed: TriggerObservation = prior?.revision === config.revision
      ? {lastObservedAt:prior.lastObservedAt,...(prior.lastOccurrenceId===undefined?{}:{lastOccurrenceId:prior.lastOccurrenceId})}
      : { lastObservedAt: timestamp };
    const next: ObservationState = { ...observed, revision: config.revision, lastObservedAt: timestamp };
    this.observations.set(triggerId, next);
    const occurrence = dueOccurrence(config, observed, timestamp);
    if (!occurrence) return { kind: "skipped", reason: "not-due", config };

    // An older durable claim can represent a run that reached an external side
    // effect or a workflow waiting for an explicit decision. Never skip past it.
    const existing = (await this.options.client.list(signal))
      .find((item) => item.config.triggerId === triggerId)?.occurrences
      .find((record) => record.status === "claimed");
    if (existing) return {
      kind: "blocked",
      reason: "unsettled-claim",
      occurrence,
      record: existing,
      ...(existing.workflowTaskId ? { workflowTaskId: existing.workflowTaskId } : {}),
    };

    const runController = new AbortController();
    const cancelRun = () => runController.abort();
    signal.addEventListener("abort", cancelRun, { once: true });
    if (signal.aborted) cancelRun();
    let handle: TriggerRuntimeHandle | undefined;
    try {
      runController.signal.throwIfAborted();
      handle = await this.options.createRuntime(runController.signal);
      if (this.usedRuntimes.has(handle.runtime)) throw Error("BLK-TRIGGER-SESSION-REUSED");
      this.usedRuntimes.add(handle.runtime);
      if (handle.project.manifest.projectId !== config.projectId)
        return { kind: "rejected", reason: "binding", errorCode: "BLK-TRIGGER-BINDING" };
      if (!(await durableTarget(handle.project, config, handle.userRegistry)))
        return { kind: "rejected", reason: "target-not-durable", errorCode: "BLK-TRIGGER-WORKFLOW-REQUIRED" };
      const current = await this.options.client.read(triggerId, signal);
      if (!sameConfig(current, config)) return { kind: "rejected", reason: "binding", errorCode: "BLK-TRIGGER-BINDING" };
      signal.throwIfAborted();
      const claim = await this.options.client.claim(config.triggerId, config.revision, {
        occurrenceId: occurrence.occurrenceId,
        scheduledAt: occurrence.scheduledAt,
        kind: "timer",
      }, signal);
      next.lastOccurrenceId = occurrence.occurrenceId;
      if (!claim.claimed) return { kind: "duplicate", occurrence, record: claim.record };
      const outcome = await this.executeClaimed(handle, config, occurrence, claim.record, "", runController, signal);
      handle = undefined;
      return outcome;
    } catch (error) {
      return { kind: "indeterminate", occurrence, errorCode: signal.aborted ? "BLK-RUN-005" : stableErrorCode(error) };
    } finally {
      try { await handle?.dispose(); } catch { /* No claim exists on preflight paths; claimed paths dispose inside executeClaimed. */ }
      signal.removeEventListener("abort", cancelRun);
    }
  }

  runExternal(record: TriggerRecord, payload: Json, signal: AbortSignal, freshBatchIds?: string[]): Promise<TriggerOutcome> {
    const result = this.externalQueue.then(() => this.runExternalSerial(record, payload, signal, freshBatchIds));
    this.externalQueue = result.then(() => {}, () => {});
    return result;
  }

  private async runExternalSerial(record: TriggerRecord, payload: Json, signal: AbortSignal, freshBatchIds?: string[]): Promise<TriggerOutcome> {
    const occurrence = recordOccurrence(record);
    const eventKey = JSON.stringify([record.projectId, record.triggerId, record.occurrenceId, record.claimRevision]);
    const allowedFresh = new Set(freshBatchIds ?? [record.occurrenceId]);
    const discard = () => { for (const id of allowedFresh) this.discardedExternal.add(id); };
    if (this.processedExternal.has(eventKey) || this.startedExternal.has(eventKey) || allowedFresh.has(record.occurrenceId) === false ||
      [...allowedFresh].some((id) => this.startedExternal.has(externalId(record.projectId, record.triggerId, id)) || this.discardedExternal.has(id))) {
      discard();
      return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: "BLK-TRIGGER-DUPLICATE" };
    }
    if (record.kind !== "external" || record.status !== "claimed" || record.claimRevision !== 1 || !record.eventId) {
      discard();
      return { kind: "rejected", reason: "binding", errorCode: "BLK-TRIGGER-BINDING" };
    }
    if (signal.aborted) { discard(); return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: "BLK-RUN-005" }; }
    let records: TriggerRecord[];
    let config: TriggerConfig | null;
    try {
      const inventory = await this.options.client.list(signal);
      const item = inventory.find((candidate) => candidate.config.triggerId === record.triggerId);
      records = item?.occurrences ?? [];
      const persisted = records.find((candidate) => candidate.occurrenceId === record.occurrenceId);
      if (!persisted || !sameRecord(persisted, record)) { discard(); return { kind: "rejected", reason: "binding", errorCode: "BLK-TRIGGER-BINDING" }; }
      const unbound = records.find((candidate) => candidate.status === "claimed" && !allowedFresh.has(candidate.occurrenceId));
      if (unbound) { discard(); return { kind: "blocked", reason: "unsettled-claim", occurrence, record: unbound }; }
      if ([...allowedFresh].some((id) => !records.some((candidate) =>
        candidate.occurrenceId === id && candidate.status === "claimed" && candidate.kind === "external" &&
        candidate.configRevision === record.configRevision))) {
        discard(); return { kind: "rejected", reason: "binding", errorCode: "BLK-TRIGGER-BINDING" };
      }
      config = await this.options.client.read(record.triggerId, signal);
      if (!sameExternalConfig(config, record)) { discard(); return { kind: "rejected", reason: "binding", errorCode: "BLK-TRIGGER-BINDING" }; }
    } catch (error) {
      discard();
      return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: signal.aborted ? "BLK-RUN-005" : stableErrorCode(error) };
    }
    const runController = new AbortController();
    const cancelRun = () => runController.abort();
    signal.addEventListener("abort", cancelRun, { once: true });
    if (signal.aborted) cancelRun();
    let handle: TriggerRuntimeHandle | undefined;
    try {
      runController.signal.throwIfAborted();
      handle = await this.options.createRuntime(runController.signal);
      if (this.usedRuntimes.has(handle.runtime)) throw Error("BLK-TRIGGER-SESSION-REUSED");
      this.usedRuntimes.add(handle.runtime);
      if (handle.project.manifest.projectId !== record.projectId || !(await durableTarget(handle.project, config!, handle.userRegistry)))
        { discard(); return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: "BLK-TRIGGER-WORKFLOW-REQUIRED" }; }
      const current = await this.options.client.read(record.triggerId, signal);
      if (!sameExternalConfig(current, record))
        { discard(); return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: "BLK-TRIGGER-BINDING" }; }
      if (signal.aborted) { discard(); return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: "BLK-RUN-005" }; }
      this.startedExternal.add(eventKey);
      this.processedExternal.add(eventKey);
      const outcome = await this.executeClaimed(handle, config, occurrence, record, canonicalJson(payload), runController, signal);
      handle = undefined;
      if (outcome.kind !== "completed") discard();
      return outcome;
    } catch (error) {
      discard();
      return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: signal.aborted ? "BLK-RUN-005" : stableErrorCode(error) };
    } finally {
      try { await handle?.dispose(); } catch { /* An uncertain external claim remains pending. */ }
      signal.removeEventListener("abort", cancelRun);
    }
  }

  private async executeClaimed(
    handle: TriggerRuntimeHandle,
    config: TriggerConfig,
    occurrence: TriggerOccurrence,
    record: TriggerRecord,
    input: string,
    runController: AbortController,
    signal: AbortSignal,
  ): Promise<TriggerOutcome> {
    let result: RunResult | undefined;
    let errorCode: string | undefined;
    let disposed = true;
    try {
      result = await handle.runtime.run(handle.project, config.exportId, input, {
        moduleId: config.moduleId,
        signal: runController.signal,
        ...(handle.userRegistry ? { userRegistry: handle.userRegistry } : {}),
        ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
      });
      if (result.status !== "completed") errorCode = runErrorCode(result);
      else if (!result.workflow?.taskId) errorCode = "BLK-TRIGGER-WORKFLOW-REQUIRED";
    } catch (error) {
      errorCode = signal.aborted ? "BLK-RUN-005" : stableErrorCode(error);
    } finally {
      try { await handle.dispose(); } catch { disposed = false; errorCode = "BLK-TRIGGER-DISPOSE"; }
    }
    if (errorCode || !disposed || result?.status !== "completed" || !result.workflow?.taskId)
      return { kind: "blocked", reason: "uncertain-result", occurrence, record, ...(errorCode ? { errorCode } : {}), ...(result?.workflow?.taskId ? { workflowTaskId: result.workflow.taskId } : {}), ...(result ? { result } : {}) };
    try {
      const settled = await this.options.client.complete(record.triggerId, record.occurrenceId, record.claimRevision, {
        status: "completed", workflowTaskId: result.workflow.taskId,
      }, new AbortController().signal);
      return { kind: "completed", occurrence, record: settled, result };
    } catch (error) {
      return { kind: "blocked", reason: "uncertain-result", occurrence, record, errorCode: stableErrorCode(error), workflowTaskId: result.workflow.taskId, result };
    }
  }

  async watch(
    triggerId: string,
    signal: AbortSignal,
    onOutcome?: (outcome: TriggerOutcome) => void,
  ): Promise<void> {
    while (!signal.aborted) {
      const outcome = await this.runDue(triggerId, signal);
      onOutcome?.(outcome);
      if (["blocked", "rejected", "indeterminate", "duplicate"].includes(outcome.kind)) return;
      if (!signal.aborted) await abortableDelay(this.pollIntervalMs, signal);
    }
  }
}

function recordOccurrence(record: TriggerRecord): TriggerOccurrence {
  return {
    occurrenceId: record.occurrenceId,
    projectId: record.projectId,
    triggerId: record.triggerId,
    revision: record.configRevision,
    moduleId: record.moduleId,
    exportId: record.exportId,
    scheduledAt: record.scheduledAt,
  };
}

function sameConfig(left: TriggerConfig | null, right: TriggerConfig): left is TriggerConfig {
  return !!left && left.projectId === right.projectId && left.triggerId === right.triggerId &&
    left.revision === right.revision && left.enabled && right.enabled && left.type === right.type &&
    left.moduleId === right.moduleId && left.exportId === right.exportId;
}

function sameExternalConfig(left: TriggerConfig | null, record: TriggerRecord): left is Extract<TriggerConfig, { type: "external" }> {
  return !!left && left.type === "external" && left.enabled && left.projectId === record.projectId &&
    left.triggerId === record.triggerId && left.revision === record.configRevision &&
    left.moduleId === record.moduleId && left.exportId === record.exportId;
}

function sameRecord(left: TriggerRecord, right: TriggerRecord) {
  return left.projectId === right.projectId && left.triggerId === right.triggerId &&
    left.configRevision === right.configRevision && left.moduleId === right.moduleId &&
    left.exportId === right.exportId && left.occurrenceId === right.occurrenceId &&
    left.scheduledAt === right.scheduledAt && left.kind === right.kind &&
    left.eventId === right.eventId && left.claimRevision === right.claimRevision &&
    left.status === right.status && left.workflowTaskId === right.workflowTaskId &&
    left.stableErrorCode === right.stableErrorCode;
}

function externalId(projectId: string, triggerId: string, occurrenceId: string) {
  return JSON.stringify([projectId, triggerId, occurrenceId, 1]);
}

async function durableTarget(project: Project, config: TriggerConfig, userRegistry?: Map<string, Resource>) {
  const compiled = await compileProject(project, userRegistry);
  const entry = compiled.interaction.entries.find((item) => item.moduleId === config.moduleId && item.interactionId === config.exportId);
  if (!entry) return false;
  const module = compiled.modules.find((item) => item.moduleId === entry.moduleId);
  const root = module?.roots.find((item) => item.nodeId === entry.ownerAgentId);
  return !!root && resolveRunEntry(root, entry.interactionId)?.workflowRoot?.blockType === "runtime.task.durable";
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
