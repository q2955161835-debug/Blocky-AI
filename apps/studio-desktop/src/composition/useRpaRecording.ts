import { useEffect, useRef, useState } from "react";
import { recordingReview, rpaRecordingResultSchema, rpaRecordingStartSchema, type RpaRecordingResult, type RpaRecordingStart } from "@blocky/rpa-core/recording";
import { rpaNative, type RpaRecordingStatus } from "./rpa";

type Capture = { request: RpaRecordingStart; stopping: boolean; stop?: Promise<void>; timer?: ReturnType<typeof setTimeout> };
const code = (error: unknown) => String(error).match(/BLK-RPA-[A-Z0-9-]+/)?.[0] ?? "BLK-RPA-RECORD-001";
const stopLabels: Record<string, string> = { stopped: "已停止录制", limit: "已达到录制上限", expired: "录制已到期", "target-lost": "目标已关闭", "capture-failed": "录制已中断" };

export function useRpaRecording(busyChanged: (busy: boolean) => void) {
  const active = useRef<Capture | undefined>(undefined), mounted = useRef(true);
  const [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false), [message, setMessage] = useState("");
  const [recording, setRecording] = useState<{ result: RpaRecordingResult; request: RpaRecordingStart }>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const capture = active.current;
      if (capture) {
        capture.stopping = true; clearTimeout(capture.timer);
        if (!capture.stop) void rpaNative.recordStop(capture.request.projectId, capture.request.sessionId).catch(() => {});
      }
    };
  }, []);
  const stop = async (capture = active.current): Promise<void> => {
    if (!capture) return;
    if (capture.stop) return capture.stop;
    capture.stopping = true; clearTimeout(capture.timer);
    if (mounted.current) setStopping(true);
    capture.stop = (async () => {
      try {
        const response = await rpaNative.recordStop(capture.request.projectId, capture.request.sessionId);
        if (response.sessionId !== capture.request.sessionId || response.state !== "stopped") throw Error("BLK-RPA-RECORD-001");
        const result = response.recording === null ? undefined : rpaRecordingResultSchema.parse(response.recording);
        if (result) {
          if (result.sessionId !== capture.request.sessionId || result.projectId !== capture.request.projectId) throw Error("BLK-RPA-RECORD-001");
          if (result.actions.length) recordingReview(result, capture.request);
        }
        if (!mounted.current || active.current !== capture) return;
        active.current = undefined;
        setRecording(result ? { result, request: capture.request } : undefined);
        setMessage(result ? `${stopLabels[result.reason]}：${result.actions.length} 步，略过 ${result.omitted} 项。${result.actions.length ? "" : "没有可审阅的步骤。"}` : "已取消录制");
        setBusy(false); busyChanged(false);
      } catch (error) {
        if (mounted.current && active.current === capture) setMessage(`${code(error)} · 停止结果未确认，请重试停止。`);
      } finally {
        capture.stop = undefined;
        if (mounted.current) setStopping(false);
      }
    })();
    return capture.stop;
  };
  const update = (capture: Capture, status: RpaRecordingStatus) => {
    if (status.sessionId !== capture.request.sessionId || !["recording", "stopping", "stopped", "awaiting-approval"].includes(status.state) || !Number.isInteger(status.count) || status.count < 0 || status.count > 100) throw Error("BLK-RPA-RECORD-001");
    if (!mounted.current || active.current !== capture || capture.stopping) return;
    if (["stopped", "stopping"].includes(status.state)) { void stop(capture); return; }
    setMessage(status.state === "awaiting-approval" ? "等待录制授权" : `录制中：${status.count} 步，略过 ${status.omitted ?? 0} 项`);
    capture.timer = setTimeout(async () => {
      if (!mounted.current || capture.stopping || active.current !== capture) return;
      try { update(capture, await rpaNative.recordStatus(capture.request.projectId, capture.request.sessionId)); }
      catch { await stop(capture); }
    }, 1000);
  };
  const start = async (input: unknown) => {
    if (active.current) return;
    let request: RpaRecordingStart;
    try { request = rpaRecordingStartSchema.parse(input); }
    catch { setMessage("请选择有效的录制目标。"); return; }
    const capture: Capture = { request, stopping: false };
    active.current = capture; setRecording(undefined); setBusy(true); busyChanged(true); setMessage("等待录制授权");
    try { update(capture, await rpaNative.recordStart(request)); }
    catch (error) {
      if (!mounted.current || capture.stopping || active.current !== capture) return;
      await stop(capture);
      if (mounted.current && !active.current && code(error) !== "BLK-RPA-CANCELLED") setMessage(code(error));
    }
  };
  return { busy, stopping, message, recording, start, stop: () => stop(), discard: () => { setRecording(undefined); setMessage("已丢弃录制草案"); } };
}
