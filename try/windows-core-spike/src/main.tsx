import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { TauriHostBridge } from "./host/TauriHostBridge";

const hostBridge = new TauriHostBridge();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App hostBridge={hostBridge} />
  </StrictMode>,
);
