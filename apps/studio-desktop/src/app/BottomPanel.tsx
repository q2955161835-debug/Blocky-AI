import { projectLog, logChannels } from "@blocky/observability";
import type { StudioLogs } from "../composition/useLogs";
import type { Studio } from "../composition/useStudio";
import type { StudioTask } from "../composition/useTask";
import { TaskPanel } from "./TaskPanel";
const views = [
  ["problems", "问题"],
  ["logs", "运行日志"],
  ["terminal", "终端"],
  ["output", "输出"],
] as const;
export function BottomPanel({
  studio: s,
  task,
  logs,
}: {
  studio: Studio;
  task?: StudioTask;
  logs?: StudioLogs;
}) {
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
            {id === "problems" && !!s.diagnostics.length && (
              <b>{s.diagnostics.length}</b>
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
          {s.session.view === "output" && logs && (
            <div className="output-controls">
              <label>
                通道{" "}
                <select
                  aria-label="输出通道"
                  value={logs.channel}
                  onChange={(e) => logs.setChannel(e.target.value)}
                >
                  <option value="">全部</option>
                  {logChannels.map((channel) => (
                    <option key={channel}>{channel}</option>
                  ))}
                </select>
              </label>
              <button onClick={logs.clearView}>清除视图</button>
              <button onClick={() => void logs.clearStorage()}>清除存储</button>
              <button onClick={() => void logs.exportLogs()}>
                导出诊断摘要
              </button>
              <span>
                已截断 {s.bus.dropped} 条 · 警告/错误 {s.bus.droppedImportant}{" "}
                条
              </span>
            </div>
          )}
          {s.session.view === "problems" &&
            (s.diagnostics.length ? (
              s.diagnostics.map((d) => (
                <button
                  className={`log-row ${d.severity}`}
                  key={d.diagnosticId}
                  onClick={() => d.source && s.navigate(d.source)}
                >
                  <span>{d.severity === "info" ? "ℹ" : "●"}</span>
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
            s.bus.records
              .filter((r) => !logs?.channel || r.channel === logs.channel)
              .map((r) => (
                <div className="log-row" key={r.logId}>
                  <time>{r.timestamp.slice(11, 19)}</time>
                  <code>{r.channel}</code>
                  <span>{r.message}</span>
                </div>
              ))}
          {s.session.view === "terminal" &&
            (task ? (
              <TaskPanel task={task} />
            ) : (
              <div className="panel-empty">尚无任务运行</div>
            ))}
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
