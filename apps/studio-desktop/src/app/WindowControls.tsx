import { useEffect, useEffectEvent, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./WindowControls.css";

export function WindowControls({ onError }: { onError(message: string): void }) {
  const desktop = isTauri();
  const [maximized, setMaximized] = useState(false);
  const reportError = useEffectEvent(() => onError("窗口状态未能读取，请重试。"));
  useEffect(() => {
    if (!desktop) return;
    const current = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const value = await current.isMaximized();
        if (active) setMaximized(value);
      } catch { if (active) reportError(); }
    };
    void refresh();
    void current.onResized(refresh).then(stop => {
      if (active) unlisten = stop;
      else stop();
    }).catch(() => { if (active) reportError(); });
    return () => { active = false; unlisten?.(); };
  }, [desktop]);
  if (!desktop) return null;
  const act = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const current = getCurrentWindow();
      await current[action]();
      if (action === "toggleMaximize") setMaximized(await current.isMaximized());
    } catch { onError("窗口操作未能完成，请重试。"); }
  };
  return <div className="window-controls" role="group" aria-label="窗口控制">
    <button aria-label="最小化窗口" title="最小化" onClick={() => void act("minimize")}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11h10" /></svg>
    </button>
    <button aria-label={maximized ? "还原窗口" : "最大化窗口"} title={maximized ? "还原" : "最大化"} onClick={() => void act("toggleMaximize")}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d={maximized ? "M5 3h8v8 M3 5h8v8H3z" : "M3 3h10v10H3z"} /></svg>
    </button>
    <button className="window-close" aria-label="关闭窗口" title="关闭" onClick={() => void act("close")}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10 M13 3 3 13" /></svg>
    </button>
  </div>;
}
