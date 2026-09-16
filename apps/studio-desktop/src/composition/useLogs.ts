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
  const flush = async () => {
    if (writing.current) await writing.current;
    if (!queue.current.length) {
      if (error.current) throw Error("BLK-LOG-004");
      return;
    }
    const batch = queue.current.splice(0, 500);
    const pending = invoke("append_diagnostics", { records: batch })
      .then(() => {
        error.current = false;
      })
      .catch(() => {
        queue.current.unshift(...batch);
        error.current = true;
        throw Error("BLK-LOG-004");
      });
    writing.current = pending;
    try {
      await pending;
    } finally {
      if (writing.current === pending) writing.current = null;
    }
    if (queue.current.length) await flush();
  };
  useEffect(() => {
    const unsubscribe = studio.bus.subscribe((record) => {
      bump((v) => v + 1);
      if (record) {
        if (queue.current.length >= 1000) {
          error.current = true;
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
    try {
      if (writing.current) await writing.current.catch(() => {});
      await invoke("clear_diagnostics");
      queue.current = [];
      error.current = false;
      studio.setMessage("已清除本机诊断存储，当前视图保留。");
    } catch {
      studio.setMessage("诊断存储清除失败。");
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
    channel,
    setChannel,
    flush,
    clearStorage,
    exportLogs,
    clearView: () => studio.bus.clearView(),
  };
}
export type StudioLogs = ReturnType<typeof useLogs>;
