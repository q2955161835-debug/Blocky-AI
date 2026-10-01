import { build } from "esbuild";
import { installDocumentParser } from "../../scripts/install-document-parser.mjs";
import { installKnowledgeModels } from "../../scripts/install-knowledge-models.mjs";
import { installAudioRuntime } from "../../scripts/install-audio-runtime.mjs";
import { installBrowser } from "../../scripts/browser-runtime.mjs";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeGenerated } from "../../scripts/write-generated.mjs";
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
const cliBytes = await readFile("dist/main.mjs");
await writeGenerated(
  "cli-runtime-lock.json",
  JSON.stringify(
    {
      schemaVersion: "blocky.cli-runtime/v1",
      bytes: cliBytes.length,
      sha256: createHash("sha256").update(cliBytes).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
// Native binaries embed this lock; generate it before compiling them.
if (process.argv[2] === "--bundle-only") process.exit(0);
await mkdir("dist/bin", { recursive: true });
await installBrowser("dist/bin");
await installDocumentParser("dist/bin");
await installKnowledgeModels("dist/bin");
await installAudioRuntime("dist/bin");
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
