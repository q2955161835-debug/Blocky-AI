import type { InteractionManifest } from "../core/interactionManifest";
import type { RuntimeEvent } from "../core/runtimeEvents";
import { EventTimeline } from "./EventTimeline";
import {
  RuntimeComposer,
  type RuntimeComposerProps,
  type RuntimeInput,
} from "./RuntimeComposer";

export interface RuntimePanelProps {
  manifest: InteractionManifest;
  activeEntryId: string | null;
  onActiveEntryIdChange(entryId: string): void;
  onSubmit(message: RuntimeInput): Promise<void>;
  events: readonly RuntimeEvent[];
  disabled: boolean;
}

export function RuntimePanel({
  manifest,
  activeEntryId,
  onActiveEntryIdChange,
  onSubmit,
  events,
  disabled,
}: RuntimePanelProps) {
  if (manifest.entries.length === 0) {
    return (
      <section className="runtime-panel runtime-panel--empty">
        <p>添加聊天入口后才能运行作品</p>
      </section>
    );
  }

  const composerProps: RuntimeComposerProps = {
    manifest,
    activeEntryId,
    onActiveEntryIdChange,
    onSubmit,
    disabled,
  };

  return (
    <section className="runtime-panel">
      <EventTimeline events={events} />
      <RuntimeComposer {...composerProps} />
    </section>
  );
}
