import { useState, type ReactNode } from "react";
import type { Studio } from "../composition/useStudio";
import type { SourceRef } from "@blocky/language-schema";
import { KnowledgeCitations } from "./KnowledgeCitations";
import { knowledgeNative } from "../composition/knowledge";
import type { EvidenceCitation } from "@blocky/knowledge-core";
import { RunOutputs } from "./RunOutputs";
import { RunSettings } from "./RunSettings";
import {
  ChatMenuButton,
  ChatPopover,
  useChatMenu,
  type ChatMenuControl,
} from "./ChatControls";
import "./BuilderChat.css";
export function RunPanel({
  studio: s,
  execute,
  onTraceContext,
  settings,
  context,
  menu: menuControl,
}: {
  studio: Studio;
  execute(id: string): void;
  onTraceContext?(x: number, y: number, source: SourceRef): void;
  settings?: ReactNode;
  context?: ReactNode;
  menu?: ChatMenuControl;
}) {
  const menu = useChatMenu(menuControl);
  const [submitted, setSubmitted] = useState("");
  const entries = s.compiled?.interaction.entries ?? [];
  const submit = () => {
    if (!s.canRun) return;
    setSubmitted(s.question);
    menu.set(null);
    void s.run();
  };
  return (
    <section className="run-panel chat-panel" aria-label="Blocky Agent 聊天">
      <div className="chat-panel-header">
        {s.running && (
          <span className="chat-run-status" role="status">
            {s.paused ? "已暂停" : "运行中…"}
          </span>
        )}
        <ChatMenuButton menu={menu} kind="settings" label="Blocky Agent 设置">
          ⚙
        </ChatMenuButton>
      </div>
      <div
        className="builder-chat-thread"
        aria-label="Blocky Agent 聊天记录"
        role="log"
        aria-live="polite"
      >
        {submitted && (
          <article className="builder-chat-message builder-chat-message-user">
            <p>{submitted}</p>
          </article>
        )}
        {s.result && (
          <article className="answer">
            <span className="answer-heading">
              {s.result.status === "cancelled"
                ? "已停止"
                : s.result.status === "failed"
                  ? "运行失败"
                  : s.result.status === "waiting"
                    ? "等待工作流处理"
                    : "回答"}
            </span>
            <p>{s.result.answer || "请在运行日志中查看详情。"}</p>
            <RunOutputs key={s.result.events[0]?.runId} result={s.result} />
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

        {!entries.length && (
          <p className="chat-inline-hint">添加交互入口后即可对话。</p>
        )}
      </div>
      <ChatPopover menu={menu} kind="add" label="Blocky Agent 上下文">
        <p>当前项目：{s.snapshot.project.manifest.displayName}</p>
        {context}
      </ChatPopover>
      <ChatPopover menu={menu} kind="settings" label="Blocky Agent 设置">
        <RunSettings
          studio={s}
          execute={execute}
          onTraceContext={onTraceContext}
        >
          {settings}
        </RunSettings>
      </ChatPopover>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="向 Agent 提问"
          rows={2}
          value={s.question}
          disabled={s.running || s.busy || s.exiting}
          onChange={(event) => s.setQuestion(event.target.value)}
          placeholder="向 Agent 提问"
          title="Enter 发送 · Shift+Enter 换行"
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            event.preventDefault();
            submit();
          }}
        />
        <div className="chat-composer-toolbar">
          <ChatMenuButton
            menu={menu}
            kind="add"
            label="Blocky Agent 添加上下文"
          >
            ＋
          </ChatMenuButton>
          <ChatMenuButton
            menu={menu}
            kind="settings"
            label="运行设置"
            className="chat-model-chip"
          >
            运行设置<span aria-hidden="true">⌄</span>
          </ChatMenuButton>
          <span className="chat-toolbar-spacer" />
          {s.running ? (
            <button
              className="chat-icon"
              type="button"
              aria-label="停止"
              title="停止"
              onClick={s.stop}
            >
              ■
            </button>
          ) : (
            <button
              className="chat-send"
              type="submit"
              aria-label="运行"
              title="发送并运行"
              disabled={!s.canRun}
            >
              ↑
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
