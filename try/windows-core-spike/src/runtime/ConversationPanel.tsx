import {
  ChevronDown16Regular,
  ChevronRight16Regular,
} from "@fluentui/react-icons";
import { useState, type CSSProperties } from "react";
import type { ConversationTurn } from "./conversationProjection";

interface ConversationPanelProps {
  readonly turns: readonly ConversationTurn[];
}

export function ConversationPanel({ turns }: ConversationPanelProps) {
  const [expandedRunIds, setExpandedRunIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  return (
    <section className="conversation" aria-label="对话记录">
      {turns.map((turn) => {
        const expanded = expandedRunIds.has(turn.runId);
        return (
          <article
            key={turn.runId}
            className="conversation-turn"
            data-status={turn.status}
          >
            <p className="conversation-message conversation-message--user">
              {turn.userText}
            </p>
            <p className="conversation-message conversation-message--assistant">
              {turn.assistantText}
            </p>
            <button
              type="button"
              className="conversation-trace__toggle"
              aria-expanded={expanded}
              onClick={() => setExpandedRunIds((current) => {
                const next = new Set(current);
                if (expanded) next.delete(turn.runId);
                else next.add(turn.runId);
                return next;
              })}
            >
              {expanded
                ? <ChevronDown16Regular aria-hidden="true" />
                : <ChevronRight16Regular aria-hidden="true" />}
              <span>执行过程</span>
            </button>
            {expanded ? (
              <ol className="conversation-trace">
                {turn.trace.map((item, index) => (
                  <li
                    key={`${item.label}-${index}`}
                    className="conversation-trace__item"
                    data-category={item.categoryId}
                    style={{ "--event-colour": item.colour } as CSSProperties}
                  >
                    <span className="conversation-trace__marker" aria-hidden="true" />
                    <span className="conversation-trace__category">
                      {item.categoryName}
                    </span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
