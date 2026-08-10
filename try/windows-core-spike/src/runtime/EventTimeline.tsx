import type { RuntimeEvent } from "../core/runtimeEvents";

export interface EventTimelineProps {
  events: readonly RuntimeEvent[];
}

function summarize(event: RuntimeEvent): string {
  const summary = JSON.stringify(event.data);
  return summary === "{}" ? "" : summary;
}

export function EventTimeline({ events }: EventTimelineProps) {
  return (
    <section className="event-timeline" aria-labelledby="event-timeline-title">
      <h2 id="event-timeline-title">事件时间线</h2>
      {events.length === 0 ? (
        <div className="event-timeline__empty" aria-hidden="true" />
      ) : (
        <ol className="event-timeline__list">
          {events.map((event) => (
            <li
              key={`${event.runId}-${event.sequence}`}
              className="event-timeline__item"
              data-event-version={event.eventVersion}
              data-run-id={event.runId}
            >
              <div className="event-timeline__meta">
                <span>#{event.sequence}</span>
                <strong>{event.type}</strong>
                {event.blockId ? <code>{event.blockId}</code> : null}
              </div>
              {summarize(event) ? (
                <p className="event-timeline__summary">{summarize(event)}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
