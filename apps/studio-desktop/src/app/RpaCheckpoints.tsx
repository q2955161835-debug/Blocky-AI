import { useEffect, useRef, useState } from "react";
import { rpaNative, type RpaCheckpoint } from "../composition/rpa";

const labels: Record<string, string> = { ready: "尚未运行", running: "运行记录待核对", paused: "已暂停", completed: "调用已完成", stopping: "正在停止", stopped: "已停止", failed: "执行失败", "settlement-failed": "进程待结算", "persistence-failed": "记录保存失败" };
export function RpaCheckpoints({ disabled }: { disabled: boolean }) {
  const [records, setRecords] = useState<RpaCheckpoint[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
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
  return <section aria-label="保存的执行记录">
    <h3>保存的执行记录</h3>
    <button disabled={disabled || busy} onClick={() => void refresh()}>刷新执行记录</button>
    <p aria-live="polite">{message}</p>
    {records.map((record) => <details key={record.checkpointId}>
      <summary>{record.planId} · {labels[record.status] ?? record.status} · {record.completedSteps}/{record.totalSteps}</summary>
      <p>{record.checkpointId}</p>
      <p>{new Date(record.updatedAtMs).toLocaleString()}</p>
      {record.receipts.map((receipt) => <p key={receipt.stepId}>{receipt.stepId}：{receipt.status === "completed" ? "调用已完成，业务结果需另行核对" : "结果待核对，请勿重复执行"}</p>)}
    </details>)}
  </section>;
}
