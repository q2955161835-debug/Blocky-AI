import type { CodingActivity, CodingEvent } from "@blocky/builder-protocol";

export const codingActivityLimit = 200;
/** Retain safe, small call metadata only; arguments, outputs and file changes stay out. */
export function updateCodingActivity(
  previous: CodingActivity[],
  event: CodingEvent,
) {
  if (!event.tool || !event.kind.startsWith("tool."))
    return { activity: previous, removed: 0 };
  const callId = event.callId ?? `event-${event.sequence}`;
  const existing = previous.find((call) => call.callId === callId);
  const call: CodingActivity = {
    callId,
    tool: event.tool,
    status:
      event.kind === "tool.started"
        ? "started"
        : event.kind === "tool.failed"
          ? "failed"
          : "completed",
    ...(existing?.command ? { command: existing.command } : {}),
    ...(event.command ? { command: event.command } : {}),
    ...(event.code ? { code: event.code } : {}),
    ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
  };
  const next = existing
    ? previous.map((entry) => (entry.callId === callId ? call : entry))
    : [...previous, call];
  return {
    activity: next.slice(-codingActivityLimit),
    removed: Math.max(0, next.length - codingActivityLimit),
  };
}
