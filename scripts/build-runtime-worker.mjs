import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeGenerated } from "./write-generated.mjs";
import { verifyPiCore } from "./check-pi-core.mjs";
import { piAgentOnlyPlugin } from "./pi-agent-entry.mjs";
await verifyPiCore();
await mkdir("tools/blocky-cli/dist", { recursive: true });
const outfile = "tools/blocky-cli/dist/runtime-worker.mjs";
const built=await build({
  entryPoints: ["tools/blocky-cli/src/runtime-worker.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  metafile: true,
  plugins: [piAgentOnlyPlugin()],
});
const piSources=[...new Set(Object.values(built.metafile.outputs).flatMap(output=>Object.entries(output.inputs).filter(([path,value])=>value.bytesInOutput>0&&path.includes("@earendil-works/")).map(([path])=>path)))];
if(piSources.some(path=>/\/harness\/|\/providers\/|pi-coding-agent|\/tools\/shell/.test(path))) throw Error("Unexpected Pi runtime imports");
await writeFile("try/pi-runtime-bundle-audit.json",JSON.stringify({piSources,forbidden:[]},null,2)+"\n");
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
