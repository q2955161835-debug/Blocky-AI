import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Studio } from "./useStudio";
import type { StudioLogs } from "./useLogs";
import type { StudioTask } from "./useTask";
import { ExitStageError, exitStage } from "./exitStage";
export function useLifecycle(
  studio: Studio,
  logs: StudioLogs,
  task: StudioTask,
  builder: { settle(): Promise<void> },
) {
  const [requested, setRequested] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [recoverable, setRecoverable] = useState(true);
  const current = useRef({ studio, logs, task, builder });
  current.current = { studio, logs, task, builder };
  const gate = useRef(false);
  const committing = useRef(false);
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
      if (!committing.current) {
        await exitStage("准备关闭窗口", () => invoke("begin_exit"));
        await exitStage("停止作品运行", () => current.current.studio.settle());
        await exitStage("停止检查任务", () => current.current.task.settle());
        await exitStage("保存构建助手会话", () =>
          current.current.builder.settle(),
        );
        // Save after producers stop so final answers and cancellations are included.
        await exitStage("保存工作台", () => current.current.studio.flush());
        await exitStage("保存诊断记录", () => current.current.logs.flush());
        await exitStage("保存诊断记录", () => invoke("prepare_exit"));
        committing.current = true;
        setRecoverable(false);
      }
      await exitStage("关闭后台服务", () => invoke("finish_exit"));
    } catch (cause) {
      let detail =
        cause instanceof ExitStageError ? cause.message : "关闭窗口未完成。";
      if (!committing.current) {
        try {
          await invoke("cancel_exit");
          current.current.studio.resumeAfterExit();
          setRecoverable(true);
          detail += "可以返回工作台，或重试退出。";
        } catch {
          setRecoverable(false);
          detail += "恢复窗口未完成，请重试退出。";
        }
      } else detail += "后台服务正在关闭，请重试退出。";
      setError(detail);
    } finally {
      gate.current = false;
      setWorking(false);
    }
  };
  const hide = async () => {
    if (gate.current || !recoverable) return;
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
    canReturn: recoverable && !working,
    exit,
    hide,
    cancel: () => {
      if (!gate.current && recoverable) setRequested(false);
    },
  };
}
