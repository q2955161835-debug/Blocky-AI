import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type CanvasAction } from "./app/App";
import { TauriWindowChromeBridge } from "./app/WindowChromeBridge";
import type { RuntimeDependencies } from "./core/deterministicRuntime";
import { TauriHostBridge } from "./host/TauriHostBridge";

const hostBridge = new TauriHostBridge();
const windowChrome = new TauriWindowChromeBridge();

async function bootstrap(): Promise<void> {
  let runtimeModel: RuntimeDependencies["model"] | undefined;
  let canvasAction: CanvasAction | undefined;
  if (import.meta.env.MODE === "wdio") {
    const { installWdioSupport } = await import("./test/wdioBootstrap");
    const support = await installWdioSupport();
    runtimeModel = support?.runtimeModel;
    canvasAction = support?.canvasAction;
  }

  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App
        hostBridge={hostBridge}
        runtimeModel={runtimeModel}
        canvasAction={canvasAction}
        windowChrome={windowChrome}
      />
    </StrictMode>,
  );
}

void bootstrap();
