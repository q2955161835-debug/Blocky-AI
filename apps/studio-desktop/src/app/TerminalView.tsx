import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import type {
  StudioTerminals,
  TerminalSnapshot,
} from "../composition/useTerminals";

export default function TerminalView({
  session,
  visible,
}: {
  session: TerminalSnapshot;
  visible: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState(session.status);
  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 2000,
      fontSize: 13,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    const appearance=()=>{
      const root=document.documentElement, style=getComputedStyle(root), light=root.dataset.theme==="light";
      terminal.options.fontFamily=style.getPropertyValue("--code-font").trim()||"Consolas, monospace";
      terminal.options.fontSize=parseFloat(style.getPropertyValue("--ui-font-size"))||13;
      terminal.options.theme=light?{background:"#ffffff",foreground:"#202938",cursor:"#2563eb",selectionBackground:"#c9def5"}:{background:"#20242c",foreground:"#eef2f7",cursor:"#eef2f7",selectionBackground:"#40516a"};
      fitRef.current();
    };
    appearance();window.addEventListener("blocky-appearance",appearance);
    let disposed = false,
      consumed = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    let sizeTimer: ReturnType<typeof setTimeout> | undefined;
    const encoder = new TextEncoder(),
      decoder = new TextDecoder();
    const resize = () => {
      if (!container.current?.clientHeight || !container.current?.clientWidth)
        return;
      fit.fit();
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(
        () =>
          void invoke("resize_terminal", {
            sessionId: session.sessionId,
            rows: Math.max(2, Math.min(500, terminal.rows)),
            cols: Math.max(2, Math.min(1000, terminal.cols)),
          }).catch(() => {}),
        100,
      );
    };
    fitRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const input = terminal.onData((data) => {
      void invoke("write_terminal", {
        sessionId: session.sessionId,
        input: data,
      }).catch(() => setStatus("输入未发送，请重试"));
    });
    const poll = async () => {
      try {
        const value = await invoke<TerminalSnapshot>("read_terminal", {
          sessionId: session.sessionId,
        });
        if (disposed) return;
        const end = value.droppedBytes + value.outputBytes;
        if (consumed < value.droppedBytes) {
          terminal.reset();
          terminal.writeln("[输出过多，已丢弃较早内容]");
          consumed = value.droppedBytes;
        }
        if (end > consumed) {
          const bytes = encoder
            .encode(value.output)
            .subarray(consumed - value.droppedBytes);
          await new Promise<void>((resolve) =>
            terminal.write(decoder.decode(bytes), resolve),
          );
          consumed = end;
        }
        if (disposed) return;
        setStatus(
          value.status === "running"
            ? "运行中"
            : `${value.status}${value.exitCode === undefined || value.exitCode === null ? "" : ` · ${value.exitCode}`}`,
        );
        if (value.status === "running" || value.status === "starting")
          timer = setTimeout(poll, 100);
      } catch {
        if (!disposed) {
          setStatus("终端连接中断");
          timer = setTimeout(poll, 1000);
        }
      }
    };
    resize();
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(sizeTimer);
      observer.disconnect();
      window.removeEventListener("blocky-appearance",appearance);
      input.dispose();
      terminal.dispose();
    };
  }, [session.sessionId]);
  useEffect(() => {
    if (visible) fitRef.current();
  }, [visible]);
  return (
    <section
      hidden={!visible}
      className="user-terminal-view"
      data-user-terminal="true"
      aria-label={`${session.profile} 终端`}
    >
      <small role="status">{status}</small>
      <div ref={container} className="terminal-emulator" />
    </section>
  );
}
