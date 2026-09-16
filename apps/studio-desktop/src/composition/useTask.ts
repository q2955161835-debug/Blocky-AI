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
  const stopping = useRef(false),
    lastId = useRef<string | undefined>(undefined),
    reported = useRef(""),
    starting = useRef<Promise<string> | undefined>(undefined);
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
        if (!active || stopping.current) return;
        setState(snapshot);
        if (snapshot.activeProcesses) {
          timer = setTimeout(poll, 200);
          return;
        }
        setRequestId(undefined);
        gate.current = false;
        setPending(false);
        reported.current = snapshot.requestId;
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
    if (stopping.current || gate.current || studio.busy || studio.exiting)
      return;
    gate.current = true;
    setPending(true);
    try {
      const request = parseTaskRequest({
        taskId: "blocky.project-check",
        parameters: { passes, "interval-ms": interval },
        timeoutMs: timeout,
        outputBudgetBytes: budget,
      });
      const launched = invoke<string>("start_task", {
        request,
        files: encodeProject(studio.controller.getSnapshot().project),
      });
      starting.current = launched;
      const id = await launched;
      setRequestId(id);
      lastId.current = id;
      setState(undefined);
      studio.setSession((v) => ({ ...v, panel: true, view: "terminal" }));
    } catch {
      gate.current = false;
      setPending(false);
      studio.setMessage("无法启动任务，请检查参数、窗口状态或正在运行的任务。");
    } finally {
      starting.current = undefined;
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
  const settle = async () => {
    stopping.current = true;
    if (starting.current) await starting.current.catch(() => {});
    await invoke("settle_tasks");
    if (lastId.current && reported.current !== lastId.current) {
      const snapshot = await invoke<TaskSnapshot>("task_status", {
        requestId: lastId.current,
      });
      if (snapshot.activeProcesses) throw Error("BLK-WINDOW-001");
      setState(snapshot);
      reported.current = snapshot.requestId;
      current.current.bus.write(
        "terminal",
        snapshot.status === "exited" ? "info" : "warning",
        "任务已结束",
        { status: snapshot.status, exitCode: snapshot.exitCode },
      );
    }
    setRequestId(undefined);
    setPending(false);
    gate.current = false;
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
    settle,
  };
}
export type StudioTask = ReturnType<typeof useTask>;
