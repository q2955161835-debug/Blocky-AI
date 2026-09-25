import type { Studio } from "../composition/useStudio";
import { interactionKey } from "@blocky/language-schema";
import { KnowledgeCitations } from "./KnowledgeCitations";
import { knowledgeNative } from "../composition/knowledge";
import type { EvidenceCitation } from "@blocky/knowledge-core";
import { RunOutputs } from './RunOutputs';
import { RunModelChoice } from './RunModelChoice';
import { RunBudgetSummary } from './RunBudgetSummary';
import { TracePanel } from './TracePanel';
export function RunPanel({ studio: s, execute }: { studio: Studio; execute(id: string): void }) {
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
          <RunModelChoice studio={s}/>
          <RunBudgetSummary project={s.snapshot.project}/>
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
            {s.running && <button onClick={() => execute("run.pause")}>{s.paused ? "继续" : "暂停"}</button>}
            {s.running && s.paused && <button onClick={() => execute("run.step")}>单步</button>}
            {!s.running && s.selected && <button onClick={() => execute("run.from-selection")}>从所选处运行</button>}
            {!s.running && s.selected && (
              <button onClick={() => execute("run.toggle-breakpoint")}>
                {s.breakpoints.some((item) => item.moduleId === s.session.active && item.blockId === s.selected)
                  ? "移除断点" : "设置断点"}
              </button>
            )}
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
              <RunOutputs key={s.result.events[0]?.runId} result={s.result}/>
              {s.result.citations.length > 0 && (
                <details>
                  <summary>{s.result.citations.length} 条资料来源</summary>
                  <KnowledgeCitations
                    projectId={s.snapshot.project.manifest.projectId}
                    call={knowledgeNative}
                    citations={
                      s.result.citations.filter(
                        (c) => !!c.collectionId,
                      ) as EvidenceCitation[]
                    }
                  />
                  {s.result.citations
                    .filter((c) => !c.collectionId)
                    .map((c) => (
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
          <TracePanel studio={s} />
        </>
      )}
    </section>
  );
}
