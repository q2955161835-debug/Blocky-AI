import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { writeGenerated } from "./write-generated.mjs";
import { piAgentOnlyPlugin } from "./pi-agent-entry.mjs";
import { verifyPiCore } from "./check-pi-core.mjs";
await verifyPiCore();

const output = resolve("try/stage5/builder-runtime");
await mkdir(output, { recursive: true });
const built = await build({
  entryPoints: ["packages/builder-engine/src/worker.ts"],
  outfile: `${output}/builder.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: true,
  metafile: true,
  // The 0.86 public barrel also reexports effectful, unused Harness tool schemas.
  // Retain its supported Agent export; do not load the unrelated barrel exports.
  plugins: [piAgentOnlyPlugin()],
});
const retained = [
  ...new Set(
    Object.values(built.metafile.outputs).flatMap((o) =>
      Object.entries(o.inputs)
        .filter(([, v]) => v.bytesInOutput > 0)
        .map(([path]) => path),
    ),
  ),
];
const forbidden = retained.filter((path) =>
  /pi-coding-agent|\/harness\/|\/tools\/shell|\/providers\/|\/api\/(?:openai|anthropic|google)/.test(
    path,
  ),
);
const builtins = [
  ...new Set(
    Object.values(built.metafile.outputs).flatMap((o) =>
      o.imports.filter((i) => i.external).map((i) => i.path),
    ),
  ),
];
if (
  forbidden.length ||
  builtins.some(
    (name) => !["node:crypto", "crypto", "process", "buffer"].includes(name),
  )
)
  throw Error(
    `Unexpected sidecar imports: ${JSON.stringify({ forbidden, builtins })}`,
  );
// Cross-platform bundling still pins the exact Windows runtime bytes.
// This prepares assets only; it does not claim to execute the Windows Host.
const runtimeArgs = process.argv.slice(2);
if (runtimeArgs.length && (runtimeArgs.length !== 2 || runtimeArgs[0] !== "--node-runtime"))
  throw Error("Usage: build-builder.mjs [--node-runtime <locked Windows node.exe>]");
const nodePath = runtimeArgs[1] ? resolve(runtimeArgs[1]) : process.execPath;
const node = await readFile(nodePath);
if (
  (!runtimeArgs.length && process.version !== "v22.23.1") ||
  createHash("sha256").update(node).digest("hex") !==
    "f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed"
)
  throw Error("Builder runtime must be locked Node 22.23.1 x64");
await copyFile(nodePath, `${output}/node.exe`);
const files = [];
for (const name of ["builder.mjs", "node.exe"]) {
  const bytes = await readFile(`${output}/${name}`);
  files.push({
    name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const manifest =
  JSON.stringify(
    {
      schemaVersion: "blocky.builder-runtime/v1",
      nodeVersion: "22.23.1",
      piVersion: "0.86.0",
      files,
    },
    null,
    2,
  ) + "\n";
await writeFile(`${output}/manifest.json`, manifest);
await writeGenerated("packages/builder-engine/runtime-lock.json", manifest);
await writeFile(
  "try/stage5/builder-bundle-audit.json",
  JSON.stringify({ retained, builtins, forbidden, files }, null, 2) + "\n",
);
console.log(JSON.stringify({ files, builtins, forbidden }));
