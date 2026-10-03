import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error The shared build audit is an ESM build script.
import { piAgentEntry } from "../../scripts/pi-agent-entry.mjs";
export default defineConfig({
  plugins: [react(),{name:"pi-agent-only",enforce:"pre",async load(id){const entry=await piAgentEntry(id);return entry?.contents;}}],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  build: { target: "es2022", outDir: "dist", sourcemap: false },
});
