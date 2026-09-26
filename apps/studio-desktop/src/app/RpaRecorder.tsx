import { useState } from "react";
import type { RpaPlan } from "@blocky/rpa-core";
import { recordingReview } from "@blocky/rpa-core/recording";
import { useRpaRecording } from "../composition/useRpaRecording";

export function RpaRecorder({ projectId, kind, identity, url, disabled, busyChanged, draft }: {
  projectId: string; kind: "windows" | "browser"; identity: string; url: string; disabled: boolean;
  busyChanged(busy: boolean): void; draft?(plan: RpaPlan, browserUrl?: string): Promise<void>;
}) {
  const recorder = useRpaRecording(busyChanged), [error, setError] = useState(""), [reviewing, setReviewing] = useState(false);
  const start = () => {
    setError("");
    let targetIdentity = identity;
    try { if (kind === "browser") targetIdentity = new URL(url).origin; }
    catch { setError("请输入有效的起始网址。"); return; }
    void recorder.start({ schemaVersion: "blocky.rpa-recording-start/v1", sessionId: `recording-${crypto.randomUUID()}`, projectId, target: { kind, identity: targetIdentity }, ...(kind === "browser" ? { url } : {}) });
  };
  const review = async () => {
    if (!recorder.recording || !draft || reviewing) return;
    setReviewing(true); setError("");
    try { const proposal = recordingReview(recorder.recording.result, recorder.recording.request); await draft(proposal.plan, proposal.browserUrl); }
    catch { setError("录制草案无法打开，请保留当前结果并重试。"); }
    finally { setReviewing(false); }
  };
  return <section aria-label="操作录制">
    <h3>操作录制</h3>
    <p>录制点击和填写位置，填写内容在运行时重新提供。最多 100 步或 10 分钟；停止后可审阅积木草案。</p>
    <button disabled={disabled || recorder.busy || reviewing || !!recorder.recording || !(kind === "browser" ? url : identity)} onClick={start}>开始录制</button>
    <button disabled={!recorder.busy || recorder.stopping} onClick={() => void recorder.stop()}>停止录制</button>
    <p aria-live="polite">{error || recorder.message}</p>
    {recorder.recording && <>
      <ol aria-label="录制步骤">{recorder.recording.result.actions.map((action, index) => <li key={index}>
        {action.action === "click" ? "点击" : "填写（运行时输入）"} · {action.locator.kind === "uia" ? action.locator.automationId ?? action.locator.name : `${action.locator.role} ${action.locator.name}`}
      </li>)}</ol>
      {draft && recorder.recording.result.actions.length > 0 && <button disabled={disabled || reviewing} onClick={() => void review()}>审阅录制积木</button>}
      <button disabled={reviewing} onClick={recorder.discard}>丢弃录制草案</button>
    </>}
  </section>;
}
