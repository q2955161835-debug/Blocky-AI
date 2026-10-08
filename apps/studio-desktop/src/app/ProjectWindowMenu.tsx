import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
type WorkWindow = { id: string; title: string; current: boolean };
export function ProjectWindowMenu({ title, dirty, newWindow, onError }: {
  title: string; dirty: boolean; newWindow(): Promise<void>; onError(message: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [windows, setWindows] = useState<WorkWindow[]>([]);
  const [loading, setLoading] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) { generation.current++; setOpen(false); }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const toggle = async () => {
    const request = ++generation.current;
    if (open) { setOpen(false); return; }
    setOpen(true); setLoading(true);
    try {
      const values = await invoke<WorkWindow[]>("studio_windows");
      if (generation.current === request) setWindows(values);
    } catch { if (generation.current === request) onError("作品窗口未能读取，请重试。"); }
    finally { if (generation.current === request) setLoading(false); }
  };
  if (!isTauri()) return <div className="project-title" title={title}><strong>{title}</strong>{dirty && <span className="dirty" title="未保存">●</span>}</div>;
  return <div className="project-window-menu" ref={anchor} onKeyDown={event => {
    if (event.key === "Escape") { generation.current++; setOpen(false); anchor.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
  }}>
    <button className="project-title project-switch" title={title} aria-label={`切换作品：${title}`}
      aria-haspopup="menu" aria-expanded={open} onClick={() => void toggle()}>
      <strong>{title}</strong>{dirty && <span className="dirty" title="未保存">●</span>}<span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="project-window-options" role="menu" aria-label="作品窗口">
      {loading ? <div role="status">正在读取…</div> : windows.map(item => <button key={item.id} role="menuitem"
        onClick={() => {
          generation.current++; setOpen(false);
          void invoke("focus_studio_window", {id: item.id}).catch(() => onError("作品窗口未能切换，请重试。"));
        }}>
        <span aria-hidden="true">{item.current ? "✓" : ""}</span>{item.title.replace(/ — Blocky Studio$/, "") || "开始页"}
      </button>)}
      <button role="menuitem" onClick={() => { generation.current++; setOpen(false); void newWindow(); }}>＋ 新建窗口</button>
    </div>}
  </div>;
}
