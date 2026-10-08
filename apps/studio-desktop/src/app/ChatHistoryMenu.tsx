import { useState } from "react";
import { ChatPopover, type ChatMenuControl } from "./ChatControls";
import type { ChatThread } from "../composition/chatHistory";

export function ChatHistoryMenu({
  menu,
  threads,
  activeId,
  select,
  disabled,
}: {
  menu: ChatMenuControl;
  threads: ChatThread[];
  activeId: string;
  select(id: string): Promise<unknown>;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const matching = threads
    .filter((t) =>
      t.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <ChatPopover menu={menu} kind="history" label="历史会话">
      <input
        aria-label="搜索历史会话"
        placeholder="搜索历史会话"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="chat-history-list">
        {matching.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className={thread.id === activeId ? "active" : ""}
            aria-current={thread.id === activeId ? "true" : undefined}
            disabled={disabled}
            onClick={() => {
              void select(thread.id).then(() => menu.set(null));
            }}
          >
            <span>{thread.title}</span>
            <time dateTime={thread.updatedAt}>
              {new Intl.DateTimeFormat("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(thread.updatedAt))}
            </time>
          </button>
        ))}
        {!matching.length && <p className="muted">没有匹配的会话</p>}
      </div>
    </ChatPopover>
  );
}
