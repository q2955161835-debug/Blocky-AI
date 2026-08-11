import type { CSSProperties } from "react";
import type { RuntimeEvent } from "../core/runtimeEvents";
import {
  presentRuntimeEvent,
  type ProgramBlockTypes,
} from "./eventPresentation";

export interface EventTimelineProps {
  events: readonly RuntimeEvent[];
  blockTypes: ProgramBlockTypes;
}

function summarize(event: RuntimeEvent): string {
  const summary = JSON.stringify(event.data);
  return summary === "{}" ? "" : summary;
}

export function EventTimeline({ events, blockTypes }: EventTimelineProps) {
  return (
    <section className="event-timeline" aria-labelledby="event-timeline-title">
      <h2 id="event-timeline-title">事件时间线</h2>
      {events.length === 0 ? (
        <div className="event-timeline__empty" aria-hidden="true" />
      ) : (
        <ol className="event-timeline__list">
          {events.map((event) => {
            const presentation = presentRuntimeEvent(event, blockTypes);
            return (
              <li
                key={`${event.runId}-${event.sequence}`}
                className="event-timeline__item"
                data-event-version={event.eventVersion}
                data-run-id={event.runId}
                data-category={presentation.categoryId}
                style={{
                  "--event-colour": presentation.colour,
                } as CSSProperties}
              >
                <div className="event-timeline__meta">
                  <span className="event-timeline__category">
                    {presentation.categoryName}
                  </span>
                  <span className="event-timeline__sequence">
                    #{event.sequence}
                  </span>
                  <strong>{event.type}</strong>
                  {event.blockId ? <code>{event.blockId}</code> : null}
                </div>
                {summarize(event) ? (
                  <p className="event-timeline__summary">{summarize(event)}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
