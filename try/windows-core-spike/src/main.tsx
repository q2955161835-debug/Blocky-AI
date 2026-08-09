import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { InMemoryHostBridge } from "./host/InMemoryHostBridge";

const hostBridge = new InMemoryHostBridge();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App hostBridge={hostBridge} />
  </StrictMode>,
);
