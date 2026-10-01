import { build } from "esbuild";
import { installDocumentParser } from "../../scripts/install-document-parser.mjs";
import { installKnowledgeModels } from "../../scripts/install-knowledge-models.mjs";
import {installBrowser} from "../../scripts/browser-runtime.mjs";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import {
  installDirectML,
  checkSystemRuntime,
} from "../../scripts/prepare-native-runtime.mjs";
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
await installBrowser("dist/bin");
await installDocumentParser("dist/bin");
await installKnowledgeModels("dist/bin");
await mkdir("dist/bin/builder", { recursive: true });
for (const name of ["builder.mjs", "node.exe", "manifest.json"])
  await copyFile(
    `../../try/stage5/builder-runtime/${name}`,
    `dist/bin/builder/${name}`,
  );
await mkdir("dist/licenses", { recursive: true });
await copyFile(
  "../../packages/conversion-core/fixtures/LICENSE.haystack",
  "dist/licenses/LICENSE.haystack",
);
await copyFile(
  process.argv[2] ??
    "../../apps/studio-host/target/release/blocky-project-io.exe",
  "dist/bin/blocky-project-io.exe",
);
await installDirectML("dist/bin");
await checkSystemRuntime();
await writeFile(
  "dist/blocky.cmd",
  '@echo off\r\nif exist "%~dp0..\\builder\\node.exe" (\r\n  "%~dp0..\\builder\\node.exe" "%~dp0main.mjs" %*\r\n) else (\r\n  "%~dp0bin\\builder\\node.exe" "%~dp0main.mjs" %*\r\n)\r\nexit /b %errorlevel%\r\n',
);
