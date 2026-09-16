import { projectVisual, type RuntimeEvent } from "@blocky/observability";
export type CanvasVisual = NonNullable<ReturnType<typeof projectVisual>> & {
  sequence: number;
};
export function canvasVisuals(events: RuntimeEvent[], moduleId: string) {
  const result = new Map<string, CanvasVisual>();
  for (const event of events) {
    if (event.type === "run.started") result.clear();
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
      for (const [id, visual] of result)
        if (visual.state === "active") result.delete(id);
    }
    if (event.moduleId !== moduleId) continue;
    const visual = projectVisual(event);
    if (!visual) continue;
    if (visual.state === "idle") {
      result.delete(visual.blockId);
    } else result.set(visual.blockId, { ...visual, sequence: event.sequence });
  }
  return result;
}
