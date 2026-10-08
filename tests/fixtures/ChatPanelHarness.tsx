import type { ComponentProps } from "react";
import { StudioSidebar } from "../../apps/studio-desktop/src/app/StudioSidebar";
import type { BuilderPanel as Builder } from "../../apps/studio-desktop/src/app/BuilderPanel";
import type { RunPanel as Run } from "../../apps/studio-desktop/src/app/RunPanel";
import type { CodingAgent } from "../../apps/studio-desktop/src/composition/useCodingAgent";
export function BuilderPanel({
  studio,
  builder,
  configureModel,
  promptSuggestion,
  menu,
}: ComponentProps<typeof Builder>) {
  return (
    <StudioSidebar
      studio={{
        ...studio,
        session: { ...studio.session, rightView: "builder" },
      }}
      builder={builder}
      execute={configureModel}
      enabled={() => true}
      onTraceContext={() => {}}
      promptSuggestion={promptSuggestion}
      chatMenu={menu}
    />
  );
}
export function RunPanel({
  studio,
  execute,
  onTraceContext,
  menu,
}: ComponentProps<typeof Run>) {
  const builder = {
    busy: false,
    ready: true,
    messages: [],
    events: [],
    threads: [],
    changes: [],
    activeChatId: "",
    selectChat: async () => {},
    newChat: async () => {},
  } as unknown as CodingAgent;
  return (
    <StudioSidebar
      studio={{ ...studio, session: { ...studio.session, rightView: "agent" } }}
      builder={builder}
      execute={execute}
      enabled={() => true}
      onTraceContext={onTraceContext ?? (() => {})}
      chatMenu={menu}
    />
  );
}
