import { useEffect, useRef, useState } from "react";
import { rpaNative, type RpaCheckpoint, type RpaRecoveryPreview, type RpaRecoveryRun } from "../composition/rpa";
import { RpaRecoveryDraft } from "./RpaRecoveryDraft";

const labels: Record<string, string> = { ready: "尚未运行", running: "运行记录待核对", paused: "已暂停", completed: "调用已完成", stopping: "正在停止", stopped: "已停止", failed: "执行失败", "settlement-failed": "进程待结算", "persistence-failed": "记录保存失败" };
export function RpaCheckpoints({ disabled, recover }: { disabled: boolean; recover(value: RpaRecoveryRun): Promise<void> }) {
  const [records, setRecords] = useState<RpaCheckpoint[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [preview, setPreview] = useState<RpaRecoveryPreview>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const result = await rpaNative.checkpoints();
      if (mounted.current) { setRecords(result.sort((a, b) => b.updatedAtMs - a.updatedAtMs)); setMessage(result.length ? "" : "暂无保存的执行记录"); }
    } catch (error) {
      if (mounted.current) { setRecords([]); setMessage(String(error).match(/BLK-RPA-[A-Z0-9-]+/)?.[0] ?? "BLK-RPA-JOURNAL-001"); }
    } finally { if (mounted.current) setBusy(false); }
  };
  const prepare = async (id: string) => {
    if (busy || disabled) return;
    setBusy(true); setPreview(undefined);
    try { const result = await rpaNative.recoveryPreview(id); if (mounted.current) { setPreview(result); setMessage(""); } }
    catch (error) { if (mounted.current) setMessage(String(error).match(/BLK-RPA-[A-Z0-9-]+/)?.[0] ?? "BLK-RPA-RECOVERY-001"); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section aria-label="保存的执行记录">
    <h3>保存的执行记录</h3>
    <button disabled={disabled || busy} onClick={() => void refresh()}>刷新执行记录</button>
    <p aria-live="polite">{message}</p>
    {records.map((record) => <details key={record.checkpointId}>
      <summary>{record.planId} · {labels[record.status] ?? record.status} · {record.completedSteps}/{record.totalSteps}</summary>
      <p>{record.checkpointId}</p>
      <p>{new Date(record.updatedAtMs).toLocaleString()}</p>
      {record.receipts.map((receipt) => <p key={receipt.stepId}>{receipt.stepId}：{receipt.status === "completed" ? "调用已完成，业务结果需另行核对" : "结果待核对，请勿重复执行"}</p>)}
      <button disabled={disabled || busy || !record.resumable} onClick={() => void prepare(record.checkpointId)}>准备恢复</button>
    </details>)}
    {preview && <RpaRecoveryDraft key={`${preview.checkpoint.checkpointId}:${preview.checkpoint.revision}`} preview={preview} disabled={disabled || busy} run={recover} close={() => setPreview(undefined)} />}
  </section>;
}
