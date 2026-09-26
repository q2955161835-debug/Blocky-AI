import { mkdir, readFile, writeFile, realpath, lstat } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { createHash } from "node:crypto";
const root = await realpath(process.cwd());
const target = resolve(process.argv[2] ?? "apps/studio-host/target/release");
if (!target.startsWith(root + sep)) throw Error("Runtime target must stay in project");
const directory = join(target, "cli");
let current = root;
for (const part of directory.slice(root.length + 1).split(sep)) {
  current = join(current, part);
  try { await mkdir(current); } catch (error) { if (error.code !== "EEXIST") throw error; }
  const info = await lstat(current);
  if (info.isSymbolicLink() || !info.isDirectory() || !(await realpath(current)).startsWith(root + sep)) {
    throw Error("Runtime target must stay in project without links");
  }
}
const lock = JSON.parse(await readFile("tools/blocky-cli/runtime-worker-lock.json", "utf8"));
const bytes = await readFile("tools/blocky-cli/dist/runtime-worker.mjs");
const digest = value => createHash("sha256").update(value).digest("hex");
if (bytes.length !== lock.bytes || digest(bytes) !== lock.sha256) throw Error("Runtime source failed verification");
const file = join(directory, "runtime-worker.mjs");
try {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw Error("Runtime file must not be a link");
} catch (error) { if (error.code !== "ENOENT") throw error; }
await writeFile(file, bytes);
if (digest(await readFile(file)) !== lock.sha256) throw Error("Runtime copy failed verification");
