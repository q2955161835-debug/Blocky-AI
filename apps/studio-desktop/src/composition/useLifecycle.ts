import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Studio } from "./useStudio";
import type { StudioLogs } from "./useLogs";
import type { StudioTask } from "./useTask";
export function useLifecycle(
  studio: Studio,
  logs: StudioLogs,
  task: StudioTask,
  builder: { settle(): Promise<void> },
) {
  const [requested, setRequested] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const current = useRef({ studio, logs, task, builder });
  current.current = { studio, logs, task, builder };
  const gate = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true,
      stop: (() => void) | undefined;
    void listen<string>("blocky:window", ({ payload }) => {
      const s = current.current.studio;
      if (payload === "close") setRequested(true);
      else if (payload === "pause") s.togglePause();
      else if (payload === "logs")
        s.setSession((v) => ({ ...v, panel: true, view: "logs" }));
    })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => studio.setMessage("窗口事件通道未就绪，请重新启动应用。"));
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  useEffect(() => {
    if (isTauri())
      void invoke("set_window_preferences", {
        minimizeToTray: studio.preferences.minimizeToTray,
      }).catch(() => studio.setMessage("窗口设置未能生效。"));
  }, [studio.preferences.minimizeToTray]);
  const exit = async () => {
    if (gate.current) return;
    gate.current = true;
    setWorking(true);
    setError("");
    try {
      await invoke("begin_exit");
      await current.current.studio.settle();
      await current.current.task.settle();
      await current.current.builder.settle();
      await current.current.logs.flush();
      await invoke("finish_exit");
    } catch {
      setError("退出结算未完成。请重试；诊断存储故障时可清除存储后再试。");
    } finally {
      gate.current = false;
      setWorking(false);
    }
  };
  const hide = async () => {
    try {
      await invoke("hide_window");
      setRequested(false);
    } catch {
      setError("窗口未能隐藏。");
    }
  };
  return {
    requested,
    request: () => setRequested(true),
    working,
    error,
    exit,
    hide,
    cancel: () => setRequested(false),
  };
}
