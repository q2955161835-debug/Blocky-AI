import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles.css";
createRoot(document.getElementById("root")!).render(<App />);
if (import.meta.env.MODE === "native-test") {
  document.title = "Blocky Studio · Test";
  await import("@wdio/tauri-plugin");
}
