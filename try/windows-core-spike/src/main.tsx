import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { TauriWindowChromeBridge } from "./app/WindowChromeBridge";
import { createCourseAssistantStarterWorkspace } from "./blockly/starterProjects";
import type { RuntimeDependencies } from "./core/deterministicRuntime";
import type { RuntimeEvent } from "./core/runtimeEvents";
import { TauriHostBridge } from "./host/TauriHostBridge";
import { createTauriDeepSeekModel } from "./host/TauriDeepSeekModel";

const hostBridge = new TauriHostBridge();
const windowChrome = new TauriWindowChromeBridge();

async function bootstrap(): Promise<void> {
  let runtimeModel: RuntimeDependencies["model"] | undefined = createTauriDeepSeekModel();
  const initialWorkspace = import.meta.env.MODE === "wdio"
    ? undefined
    : createCourseAssistantStarterWorkspace();
  let onRuntimeEvent: ((event: RuntimeEvent) => void) | undefined;
  if (import.meta.env.MODE === "wdio") {
    const { installWdioSupport } = await import("./test/wdioBootstrap");
    const support = await installWdioSupport();
    runtimeModel = support?.runtimeModel;
    onRuntimeEvent = support?.onRuntimeEvent;
  }

  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App
        hostBridge={hostBridge}
        initialWorkspace={initialWorkspace}
        runtimeModel={runtimeModel}
        runtimeStepDelayMs={650}
        onRuntimeEvent={onRuntimeEvent}
        windowChrome={windowChrome}
      />
    </StrictMode>,
  );
}

void bootstrap();
