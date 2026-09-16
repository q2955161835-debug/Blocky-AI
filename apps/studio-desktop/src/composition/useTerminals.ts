import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveSetting } from "@blocky/settings-core";
import type { Studio } from "./useStudio";
export interface TerminalSnapshot {
  sessionId: string;
  profile: "powershell" | "cmd";
  status: string;
  rows: number;
  cols: number;
  output: string;
  outputBytes: number;
  droppedBytes: number;
  revision: number;
  exitCode?: number;
}
export function useTerminals(studio: Studio) {
  const [sessions, setSessions] = useState<TerminalSnapshot[]>([]);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const gate = useRef(false);
  const create = async (
    profile: TerminalSnapshot["profile"] = "powershell",
  ) => {
    if (gate.current || studio.exiting || !studio.settings.ready) return;
    gate.current = true;
    setPending(true);
    try {
      const outputBudget = Math.max(
        4096,
        Math.min(
          4 * 1024 * 1024,
          resolveSetting("terminal.outputBudgetBytes", studio.settings.layers)
            .value,
        ),
      );
      const session = await invoke<TerminalSnapshot | null>("create_terminal", {
        profile,
        outputBudget,
      });
      if (session) {
        setSessions((list) => [...list, session]);
        setSelected(session.sessionId);
        studio.setSession((s) => ({ ...s, panel: true, view: "terminal" }));
      }
    } catch {
      studio.setMessage(
        "终端未能启动。最多保留 8 个会话，请检查目录和窗口状态。",
      );
    } finally {
      gate.current = false;
      setPending(false);
    }
  };
  const close = async (sessionId = selected) => {
    try {
      if (!(await studio.confirm("关闭此终端将结束其中的程序及子进程。继续？")))
        return;
      await invoke("close_terminal", { sessionId });
      setSessions((list) => list.filter((s) => s.sessionId !== sessionId));
      if (selected === sessionId)
        setSelected(
          sessions.find((s) => s.sessionId !== sessionId)?.sessionId ?? "",
        );
    } catch {
      studio.setMessage("终端结算未完成，请重试。");
    }
  };
  return { sessions, selected, setSelected, pending, create, close };
}
export type StudioTerminals = ReturnType<typeof useTerminals>;
