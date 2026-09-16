import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
});
await mkdir("dist/bin", { recursive: true });
await copyFile(
  "../../apps/studio-host/target/release/blocky-project-io.exe",
  "dist/bin/blocky-project-io.exe",
);
await writeFile(
  "dist/blocky.cmd",
  '@echo off\r\nnode "%~dp0main.mjs" %*\r\nexit /b %errorlevel%\r\n',
);
