import type { Studio } from "../composition/useStudio";
import { interactionKey } from "@blocky/language-schema";
export function RunPanel({ studio: s }: { studio: Studio }) {
  const entries = s.compiled?.interaction.entries ?? [];
  return (
    <section className="run-panel">
      <div className="section-label">
        运行 Agent{" "}
        <span>
          {s.running
            ? "运行中"
            : s.result?.status === "completed"
              ? "已完成"
              : "就绪"}
        </span>
      </div>
      {!entries.length ? (
        <div className="empty-state">添加交互入口后，即可在这里运行。</div>
      ) : (
        <>
          {entries.length > 1 && (
            <label className="prompt-label">
              运行入口
              <select
                aria-label="运行入口"
                value={s.interactionId}
                disabled={s.running || s.busy}
                onChange={(e) => s.setInteractionId(e.target.value)}
              >
                {entries.map((entry) => (
                  <option
                    key={interactionKey(entry)}
                    value={interactionKey(entry)}
                  >
                    {entry.displayName} ·{" "}
                    {
                      s.snapshot.project.manifest.modules.find(
                        (m) => m.moduleId === entry.moduleId,
                      )?.displayName
                    }
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="prompt-label">
            {
              entries.find((entry) => interactionKey(entry) === s.interactionId)
                ?.displayName
            }
            <textarea
              aria-label="向 Agent 提问"
              value={s.question}
              onChange={(e) => s.setQuestion(e.target.value)}
              placeholder="输入问题…"
            />
          </label>
          <div className="run-actions">
            <span className="muted">文字输入</span>
            <button
              className="primary"
              disabled={!s.canRun}
              onClick={() => void s.run()}
            >
              ▶ 运行
            </button>
            {s.running && <button onClick={s.stop}>停止</button>}
          </div>
          {s.result && (
            <article className="answer">
              <span className="answer-heading">
                {s.result.status === "cancelled"
                  ? "已停止"
                  : s.result.status === "failed"
                    ? "运行失败"
                    : "回答"}
              </span>
              <p>{s.result.answer || "请在运行日志中查看详情。"}</p>
              {s.result.citations.length > 0 && (
                <details>
                  <summary>{s.result.citations.length} 条资料来源</summary>
                  {s.result.citations.map((c) => (
                    <p key={c.id}>
                      {c.title}
                      <br />
                      {c.text}
                    </p>
                  ))}
                </details>
              )}
            </article>
          )}
          <details className="trace">
            <summary>运行轨迹 · {s.events.length} 个事件</summary>
            {s.events.map((event) => (
              <button
                key={event.sequence}
                onClick={() =>
                  s.navigate({
                    projectId: event.projectId,
                    moduleId: event.moduleId,
                    blockId: event.blockId,
                  })
                }
              >
                #{event.sequence} {event.type}
                <small>{event.blockId ?? "项目"}</small>
              </button>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
