import { projectLog } from "@blocky/observability";
import type { Studio } from "../composition/useStudio";
const views = [
  ["problems", "问题"],
  ["logs", "运行日志"],
  ["terminal", "终端"],
  ["output", "输出"],
] as const;
export function BottomPanel({ studio: s }: { studio: Studio }) {
  return (
    <section
      className="bottom-panel"
      style={{ height: s.session.panel ? s.session.height : 35 }}
      aria-label="底部面板"
    >
      <div className="panel-tabs">
        {views.map(([id, label]) => (
          <button
            className={s.session.view === id && s.session.panel ? "active" : ""}
            key={id}
            onClick={() =>
              s.setSession((v) => ({ ...v, panel: true, view: id }))
            }
          >
            {label}
            {id === "problems" && !!s.compiled?.diagnostics.length && (
              <b>{s.compiled.diagnostics.length}</b>
            )}
          </button>
        ))}
        <span className="spacer" />
        <button
          aria-label={s.session.panel ? "折叠面板" : "展开面板"}
          onClick={() => s.setSession((v) => ({ ...v, panel: !v.panel }))}
        >
          {s.session.panel ? "⌄" : "⌃"}
        </button>
      </div>
      {s.session.panel && (
        <div className="panel-body">
          {s.session.view === "problems" &&
            (s.compiled?.diagnostics.length ? (
              s.compiled.diagnostics.map((d) => (
                <button
                  className="log-row error"
                  key={d.diagnosticId}
                  onClick={() => d.source && s.navigate(d.source)}
                >
                  <span>●</span>
                  <code>{d.code}</code>
                  <span>{d.message}</span>
                  <small>{d.source?.blockId}</small>
                </button>
              ))
            ) : (
              <div className="panel-empty">
                ✓ {s.compiling ? "正在检查项目…" : "没有发现问题"}
              </div>
            ))}
          {s.session.view === "logs" &&
            (s.events.length ? (
              s.events.map((e) => {
                const log = projectLog(e);
                return (
                  <button
                    className={`log-row ${log.level}`}
                    key={e.sequence}
                    onClick={() => s.navigate(log.source)}
                  >
                    <time>{e.timestamp.slice(11, 19)}</time>
                    <code>#{log.eventSequence}</code>
                    <span>{log.summary}</span>
                    <small>{e.blockId ?? "项目"}</small>
                  </button>
                );
              })
            ) : (
              <div className="panel-empty">运行项目后，日志会出现在这里。</div>
            ))}
          {s.session.view === "output" &&
            s.bus.records.map((r) => (
              <div className="log-row" key={r.logId}>
                <time>{r.timestamp.slice(11, 19)}</time>
                <code>{r.channel}</code>
                <span>{r.message}</span>
              </div>
            ))}
          {s.session.view === "terminal" && (
            <div className="panel-empty">尚无任务运行</div>
          )}
        </div>
      )}
      {s.session.panel && (
        <input
          className="panel-resizer"
          type="range"
          min={120}
          max={480}
          value={s.session.height}
          aria-label="底部面板高度"
          onChange={(e) =>
            s.setSession((v) => ({ ...v, height: Number(e.target.value) }))
          }
        />
      )}
    </section>
  );
}
