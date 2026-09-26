import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  diagnosticRecord,
  projectDiagnosticScope,
  type DiagnosticRecord,
  type DiagnosticScope,
  type LogRecord,
} from "@blocky/observability";
import type { Studio } from "./useStudio";
import { resolveSetting } from "@blocky/settings-core";
type LogStats = {
  effectiveMaxBytes: number;
  storedBytes: number;
  records: number;
  maxRecords: number;
  health: {
    quarantinePresent: boolean;
    corruptStore: boolean;
    quarantinedRecords: number;
  };
};
export function useLogs(studio: Studio) {
  const [revision, bump] = useState(0);
  const channel = studio.session.outputChannel;
  const setChannel = (channel: string) =>
    studio.setSession((s) => ({ ...s, outputChannel: channel }));
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [stats, setStats] = useState<LogStats>();
  const [scopeKey, setScopeKey] = useState<keyof DiagnosticScope>("runId");
  const [scopeValue, setScopeValue] = useState("");
  const policy = useRef(Promise.resolve()),
    policyReady = useRef(false);
  const days = resolveSetting(
    "logs.retentionDays",
    studio.settings.layers,
  ).value;
  const maxBytes = resolveSetting(
    "logs.maxStoredBytes",
    studio.settings.layers,
  ).value;
  useEffect(() => {
    if (!studio.settings.ready) return;
    policy.current = policy.current
      .catch(() => {})
      .then(async () => {
        const value = await invoke<LogStats>("configure_diagnostics", {
          days,
          maxBytes,
        });
        setStats(value);
        policyReady.current = true;
      });
    void policy.current.catch(() =>
      studio.setMessage("诊断保留策略未能生效，请检查存储。"),
    );
  }, [studio.settings.ready, days, maxBytes]);
  const queue = useRef<DiagnosticRecord[]>([]),
    writing = useRef<Promise<void> | null>(null),
    error = useRef(false);
  const losses = useRef({ dropped: 0, droppedImportant: 0 }),
    inflight = useRef(0),
    clearing = useRef(false);
  const [queueDropped, setQueueDropped] = useState(0),
    [queueDroppedImportant, setQueueDroppedImportant] = useState(0);
  const flush = async () => {
    await policy.current;
    if (!policyReady.current) return;
    if (clearing.current) return;
    if (writing.current) await writing.current;
    if (clearing.current) return;
    if (!queue.current.length && !losses.current.dropped) {
      if (error.current) throw Error("BLK-LOG-004");
      return;
    }
    const batch = queue.current.splice(0, 500);
    inflight.current = batch.length;
    const loss = { ...losses.current };
    losses.current = { dropped: 0, droppedImportant: 0 };
    const pending = invoke("append_diagnostics", { records: batch, ...loss })
      .then(() => {
        error.current = false;
      })
      .catch(() => {
        queue.current.unshift(...batch);
        losses.current.dropped += loss.dropped;
        losses.current.droppedImportant += loss.droppedImportant;
        error.current = true;
        throw Error("BLK-LOG-004");
      });
    writing.current = pending;
    try {
      await pending;
    } finally {
      if (writing.current === pending) writing.current = null;
      inflight.current = 0;
    }
    if (queue.current.length || losses.current.dropped) await flush();
  };
  useEffect(() => {
    const unsubscribe = studio.bus.subscribe((record) => {
      bump((v) => v + 1);
      if (record) {
        if (queue.current.length + inflight.current >= 1000) {
          losses.current.dropped++;
          setQueueDropped((v) => v + 1);
          if (record.level !== "info") {
            losses.current.droppedImportant++;
            setQueueDroppedImportant((v) => v + 1);
          }
          studio.setMessage("诊断存储积压，请检查本机空间。");
        } else queue.current.push(diagnosticRecord(record));
      }
    });
    const timer = setInterval(
      () =>
        void flush().catch(() =>
          studio.setMessage("诊断摘要尚未保存，请检查本机空间。"),
        ),
      500,
    );
    const maintenance = setInterval(() => {
      void invoke<LogStats>("diagnostic_stats")
        .then(setStats)
        .catch(() => {});
    }, 10000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      clearInterval(maintenance);
    };
  }, [studio.bus]);
  const clearStorage = async () => {
    if (clearing.current) return;
    clearing.current = true;
    try {
      if (writing.current) await writing.current.catch(() => {});
      await policy.current.catch(() => {});
      await invoke("clear_diagnostics");
      queue.current = [];
      losses.current = { dropped: 0, droppedImportant: 0 };
      error.current = false;
      policy.current = invoke<LogStats>("configure_diagnostics", {
        days,
        maxBytes,
      }).then((value) => {
        setStats(value);
        policyReady.current = true;
      });
      await policy.current;
      studio.setMessage("已清除本机诊断存储，当前视图保留。");
    } catch {
      studio.setMessage("诊断存储清除失败。");
    } finally {
      clearing.current = false;
    }
  };
  const exportLogs = async () => {
    try {
      const scope = scopeValue
        ? projectDiagnosticScope({ [scopeKey]: scopeValue })
        : {};
      if (scopeValue && scope[scopeKey] !== scopeValue)
        throw Error("BLK-LOG-004");
      await flush();
      if (
        await invoke("export_diagnostics", {
          channel: channel || null,
          fromTimestamp: from ? new Date(from).toISOString() : null,
          toTimestamp: to ? new Date(to).toISOString() : null,
          scope: Object.keys(scope).length ? scope : null,
        })
      )
        studio.setMessage("已导出诊断摘要");
    } catch {
      studio.setMessage("诊断导出失败。");
    }
  };
  return {
    scopeKey,
    setScopeKey,
    scopeValue,
    setScopeValue,
    matches: (record: LogRecord) =>
      (!channel || record.channel === channel) &&
      (!scopeValue || record.scope?.[scopeKey] === scopeValue),
    revision,
    from,
    setFrom,
    to,
    setTo,
    stats,
    queueDropped,
    queueDroppedImportant,
    channel,
    setChannel,
    flush,
    clearStorage,
    exportLogs,
    clearView: () => studio.bus.clearView(),
  };
}
export type StudioLogs = ReturnType<typeof useLogs>;
