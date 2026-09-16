import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { encodeProject } from "@blocky/project-format";
import { parseTaskRequest, type TaskSnapshot } from "@blocky/terminal-protocol";
import type { Studio } from "./useStudio";
export function useTask(studio: Studio) {
  const [state, setState] = useState<TaskSnapshot>(),
    [pending, setPending] = useState(false),
    [requestId, setRequestId] = useState<string>();
  const [passes, setPasses] = useState(30),
    [interval, setIntervalMs] = useState(100),
    [timeout, setTimeoutMs] = useState(30000),
    [budget, setBudget] = useState(65536);
  const gate = useRef(false);
  const current = useRef(studio);
  current.current = studio;
  useEffect(() => {
    if (!requestId) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const snapshot = await invoke<TaskSnapshot>("task_status", {
          requestId,
        });
        if (!active) return;
        setState(snapshot);
        if (snapshot.activeProcesses) {
          timer = setTimeout(poll, 200);
          return;
        }
        setRequestId(undefined);
        gate.current = false;
        setPending(false);
        current.current.bus.write(
          "terminal",
          snapshot.status === "exited" ? "info" : "warning",
          "任务已结束",
          {
            taskId: snapshot.taskId,
            status: snapshot.status,
            exitCode: snapshot.exitCode,
            outputBytes: snapshot.outputBytes,
            droppedBytes: snapshot.droppedBytes,
          },
        );
      } catch {
        if (active) {
          setPending(false);
          current.current.setMessage(
            "无法读取任务状态；退出前将再次请求原生结算。",
          );
          timer = setTimeout(poll, 1000);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [requestId]);
  const start = async () => {
    if (gate.current || studio.busy) return;
    gate.current = true;
    setPending(true);
    try {
      const request = parseTaskRequest({
        taskId: "blocky.project-check",
        parameters: { passes, "interval-ms": interval },
        timeoutMs: timeout,
        outputBudgetBytes: budget,
      });
      const id = await invoke<string>("start_task", {
        request,
        files: encodeProject(studio.controller.getSnapshot().project),
      });
      setRequestId(id);
      setState(undefined);
      studio.setSession((v) => ({ ...v, panel: true, view: "terminal" }));
    } catch {
      gate.current = false;
      setPending(false);
      studio.setMessage("无法启动任务，请检查参数、窗口状态或正在运行的任务。");
    }
  };
  const cancel = async () => {
    if (requestId)
      try {
        await invoke("cancel_task", { requestId });
      } catch {
        studio.setMessage("任务停止请求失败，退出前仍需结算。");
      }
  };
  return {
    state,
    pending,
    active: !!requestId,
    passes,
    setPasses,
    interval,
    setIntervalMs,
    timeout,
    setTimeoutMs,
    budget,
    setBudget,
    start,
    cancel,
  };
}
export type StudioTask = ReturnType<typeof useTask>;
