import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { installDirectML, checkSystemRuntime } from "../../scripts/prepare-native-runtime.mjs";
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
await mkdir("dist/licenses", { recursive: true });
await copyFile(
  "../../packages/conversion-core/fixtures/LICENSE.haystack",
  "dist/licenses/LICENSE.haystack",
);
await copyFile(
  process.argv[2] ?? "../../apps/studio-host/target/release/blocky-project-io.exe",
  "dist/bin/blocky-project-io.exe",
);
await installDirectML("dist/bin");
await checkSystemRuntime();
await writeFile(
  "dist/blocky.cmd",
  '@echo off\r\nnode "%~dp0main.mjs" %*\r\nexit /b %errorlevel%\r\n',
);
