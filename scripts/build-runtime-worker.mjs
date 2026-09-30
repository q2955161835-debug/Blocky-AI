import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeGenerated } from "./write-generated.mjs";
await mkdir("tools/blocky-cli/dist", { recursive: true });
const outfile = "tools/blocky-cli/dist/runtime-worker.mjs";
await build({
  entryPoints: ["tools/blocky-cli/src/runtime-worker.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
});
const bytes = await readFile(outfile);
await writeGenerated(
  "tools/blocky-cli/runtime-worker-lock.json",
  JSON.stringify(
    {
      schemaVersion: "blocky.runtime-worker/v1",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
