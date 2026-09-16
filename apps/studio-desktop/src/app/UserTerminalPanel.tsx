import { lazy, Suspense } from "react";
import type { StudioTerminals } from "../composition/useTerminals";
const TerminalView = lazy(() => import("./TerminalView"));
export function UserTerminalPanel({
  terminals,
  visible,
}: {
  terminals: StudioTerminals;
  visible: boolean;
}) {
  return (
    <section hidden={!visible} className="user-terminals" aria-label="用户终端">
      <div className="terminal-toolbar">
        <select
          aria-label="终端布局"
          value={terminals.direction}
          onChange={(e) =>
            terminals.setDirection(e.target.value as typeof terminals.direction)
          }
        >
          <option value="single">单窗口</option>
          <option value="horizontal">左右分屏</option>
          <option value="vertical">上下分屏</option>
        </select>
        <button
          disabled={terminals.pending || terminals.sessions.length >= 8}
          onClick={() => void terminals.create()}
        >
          新建 PowerShell
        </button>
        <button
          disabled={terminals.pending || terminals.sessions.length >= 8}
          onClick={() => void terminals.create("cmd")}
        >
          新建 CMD
        </button>
        {terminals.sessions.map((session, index) => (
          <span key={session.sessionId}>
            <button
              aria-pressed={terminals.selected === session.sessionId}
              onClick={() => terminals.setSelected(session.sessionId)}
            >
              {session.profile} {index + 1}
            </button>
            <button
              aria-label={`关闭终端 ${index + 1}`}
              onClick={() => void terminals.close(session.sessionId)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {!terminals.sessions.length && <p>选择工作目录后启动终端。</p>}
      <div className={`terminal-layout terminal-layout-${terminals.direction}`}>
        {terminals.sessions.map((session) => (
          <Suspense key={session.sessionId} fallback={<p>正在加载终端…</p>}>
            <TerminalView
              key={session.sessionId}
              session={session}
              visible={
                visible &&
                (terminals.direction !== "single" ||
                  terminals.selected === session.sessionId)
              }
            />
          </Suspense>
        ))}
      </div>
    </section>
  );
}
