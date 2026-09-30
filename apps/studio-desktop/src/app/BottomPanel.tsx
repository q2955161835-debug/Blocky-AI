import { projectLog, logChannels } from "@blocky/observability";
import type { StudioLogs } from "../composition/useLogs";
import type { Studio } from "../composition/useStudio";
import type { StudioTask } from "../composition/useTask";
import { TaskPanel } from "./TaskPanel";
import { UserTerminalPanel } from "./UserTerminalPanel";
import type { StudioTerminals } from "../composition/useTerminals";
import { useEffect, useRef, useState } from "react";
import { ResizeHandle } from "./ResizeHandle";
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
  terminals,
}: {
  studio: Studio;
  task?: StudioTask;
  logs?: StudioLogs;
  terminals?: StudioTerminals;
}) {
  const root = useRef<HTMLElement>(null);
  const [space, setSpace] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSpace({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const dockedRight = s.session.dock === "right";
  const maximum = dockedRight ? Math.max(240, space.width - 240) : Math.max(120, space.height - 220);
  const size = Math.min(maximum, dockedRight ? s.session.width : s.session.height);
  return (
    <section
      ref={root}
      hidden={!s.session.panel}
      className={`bottom-panel ${s.session.maximized && s.session.panel ? "panel-maximized" : ""}`}
      style={{
        height: s.session.maximized
            ? "calc(100% - 40px)"
            : size,
      }}
      aria-label="底部面板"
    >
      {s.session.panel && !s.session.maximized && <ResizeHandle className="panel-boundary" label={dockedRight ? "面板宽度" : "底部面板高度"}
        axis={dockedRight ? "x" : "y"} reverse value={size} min={dockedRight ? 240 : 120} max={maximum}
        onChange={value => s.setSession(current => ({ ...current, [dockedRight ? "width" : "height"]: value }))} />}
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
          aria-label="切换面板停靠"
          onClick={() =>
            s.setSession((v) => ({
              ...v,
              dock: v.dock === "bottom" ? "right" : "bottom",
            }))
          }
        >
          {s.session.dock === "bottom" ? "停靠右侧" : "停靠底部"}
        </button>
        <button
          aria-label={s.session.maximized ? "还原面板" : "最大化面板"}
          onClick={() =>
            s.setSession((v) => ({
              ...v,
              panel: true,
              maximized: !v.maximized,
            }))
          }
        >
          {s.session.maximized ? "还原" : "最大化"}
        </button>
        <button
          aria-label={s.session.panel ? "折叠面板" : "展开面板"}
          onClick={() => s.setSession((v) => ({ ...v, panel: !v.panel }))}
        >
          {s.session.panel ? "⌄" : "⌃"}
        </button>
      </div>
      {terminals && (
        <UserTerminalPanel
          terminals={terminals}
          visible={s.session.panel && s.session.view === "terminal"}
        />
      )}
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
              <label>
                关联范围
                <select
                  aria-label="诊断关联字段"
                  value={logs.scopeKey}
                  onChange={(e) =>
                    logs.setScopeKey(e.target.value as typeof logs.scopeKey)
                  }
                >
                  <option value="projectId">项目</option>
                  <option value="runId">运行</option>
                  <option value="moduleId">模块</option>
                  <option value="blockId">积木</option>
                  <option value="correlationId">调用关联</option>
                </select>
                <input
                  aria-label="诊断关联标识"
                  value={logs.scopeValue}
                  maxLength={logs.scopeKey === "correlationId" ? 512 : 200}
                  onChange={(e) => logs.setScopeValue(e.target.value)}
                  placeholder="全部"
                />
              </label>
              <button
                disabled={!s.events.length}
                onClick={() => {
                  logs.setScopeKey("runId");
                  logs.setScopeValue(s.events[0].runId);
                }}
              >
                当前运行
              </button>
              <label>
                起始时间
                <input
                  aria-label="诊断导出起始时间"
                  type="datetime-local"
                  value={logs.from}
                  onChange={(e) => logs.setFrom(e.target.value)}
                />
              </label>
              <label>
                截止时间
                <input
                  aria-label="诊断导出截止时间"
                  type="datetime-local"
                  value={logs.to}
                  onChange={(e) => logs.setTo(e.target.value)}
                />
              </label>
              <button onClick={() => void logs.clearStorage()}>清除存储</button>
              <button onClick={() => void logs.exportLogs()}>
                导出诊断摘要
              </button>
              <span>
                已截断 {s.bus.dropped + logs.queueDropped} 条 · 警告/错误{" "}
                {s.bus.droppedImportant + logs.queueDroppedImportant} 条
              </span>
              {logs.stats && (
                <small>
                  存储 {logs.stats.storedBytes} / {logs.stats.effectiveMaxBytes}{" "}
                  字节 · {logs.stats.records} 条
                  {logs.stats.health.quarantinePresent
                    ? " · 已隔离损坏日志"
                    : ""}
                  {logs.stats.health.corruptStore
                    ? " · 存储损坏，请清除后重试"
                    : ""}
                </small>
              )}
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
              .filter((r) => !logs || logs.matches(r))
              .map((r) => (
                <div className="log-row" key={r.logId}>
                  <time>{r.timestamp.slice(11, 19)}</time>
                  <code>{r.channel}</code>
                  <span>
                    {r.message}
                    {r.scopeOmitted && " · 部分关联标识已省略"}
                  </span>
                </div>
              ))}
          {s.session.view === "terminal" &&
            (task ? (
              <details>
                <summary>受控任务</summary>
                <TaskPanel task={task} />
              </details>
            ) : (
              <div className="panel-empty">尚无任务运行</div>
            ))}
        </div>
      )}
    </section>
  );
}
