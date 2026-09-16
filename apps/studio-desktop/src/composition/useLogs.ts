import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { diagnosticRecord, type DiagnosticRecord } from "@blocky/observability";
import type { Studio } from "./useStudio";
export function useLogs(studio: Studio) {
  const [revision, bump] = useState(0),
    [channel, setChannel] = useState("");
  const queue = useRef<DiagnosticRecord[]>([]),
    writing = useRef<Promise<void> | null>(null),
    error = useRef(false);
  const losses = useRef({ dropped: 0, droppedImportant: 0 }),
    inflight = useRef(0),
    clearing = useRef(false);
  const [queueDropped, setQueueDropped] = useState(0),
    [queueDroppedImportant, setQueueDroppedImportant] = useState(0);
  const flush = async () => {
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
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [studio.bus]);
  const clearStorage = async () => {
    if (clearing.current) return;
    clearing.current = true;
    try {
      if (writing.current) await writing.current.catch(() => {});
      await invoke("clear_diagnostics");
      queue.current = [];
      losses.current = { dropped: 0, droppedImportant: 0 };
      error.current = false;
      studio.setMessage("已清除本机诊断存储，当前视图保留。");
    } catch {
      studio.setMessage("诊断存储清除失败。");
    } finally {
      clearing.current = false;
    }
  };
  const exportLogs = async () => {
    try {
      await flush();
      if (await invoke("export_diagnostics", { channel: channel || null }))
        studio.setMessage("已导出诊断摘要");
    } catch {
      studio.setMessage("诊断导出失败。");
    }
  };
  return {
    revision,
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
