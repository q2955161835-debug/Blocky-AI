import { createRoot } from "react-dom/client";
import "./app/styles.css";
import { App } from "./app/App";
createRoot(document.getElementById("root")!).render(<App />);
if (import.meta.env.MODE === "native-test") {
  document.title = "Blocky Studio · Test";
  await import("@wdio/tauri-plugin");
}
