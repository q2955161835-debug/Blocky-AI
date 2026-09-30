import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { writeGenerated } from "./write-generated.mjs";

const output = resolve("try/stage7/browser-runtime");
await mkdir(output, { recursive: true });
const source = await realpath(dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")));
const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
if (pkg.version !== "1.63.0") throw Error("Browser driver must be locked Playwright 1.63.0");
const built = await build({
  entryPoints: ["packages/rpa-core/src/browser-worker.ts"], outfile: join(output, "browser.mjs"),
  bundle: true, platform: "node", target: "node22", format: "esm", minify: true, sourcemap: false, metafile: true,
  external: ["playwright-core"],
});
const externals = [...new Set(Object.values(built.metafile.outputs).flatMap((item) => item.imports.filter((entry) => entry.external).map((entry) => entry.path)))];
if (externals.some((name) => !["playwright-core", "node:crypto"].includes(name))) throw Error("Unexpected browser worker import");
const node = await readFile(process.execPath);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (process.version !== "v22.23.1" || hash(node) !== "f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed") throw Error("Browser worker requires locked Node 22.23.1 x64");
await copyFile(process.execPath, join(output, "node.exe"));
const names = ["browser.mjs", "node.exe"];
async function copyTree(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw Error("Unexpected browser driver symlink");
    if (entry.isDirectory()) await copyTree(join(directory, entry.name), relative);
    else if (entry.isFile()) {
      const name = `node_modules/playwright-core/${relative}`;
      await mkdir(dirname(join(output, name)), { recursive: true });
      await copyFile(join(directory, entry.name), join(output, name)); names.push(name);
    } else throw Error("Unexpected browser driver asset");
  }
}
await copyTree(source);
const files = [];
for (const name of names.sort()) { const bytes = await readFile(join(output, name)); files.push({ name, bytes: bytes.length, sha256: hash(bytes) }); }
const manifest = JSON.stringify({ schemaVersion: "blocky.browser-runtime/v1", nodeVersion: "22.23.1", playwrightVersion: pkg.version, files }, null, 2) + "\n";
await writeFile(join(output, "manifest.json"), manifest);
await writeGenerated("packages/rpa-core/runtime-lock.json", manifest);
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), externals }));
