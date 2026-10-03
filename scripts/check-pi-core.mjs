import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Verify the exact SDK files used by the runtime bundle against its upstream lock. */
export async function verifyPiCore(root = process.cwd(), suppliedLock) {
  const lock = suppliedLock ?? JSON.parse(await readFile(resolve(root, "vendor/pi-core-lock.json"), "utf8"));
  if (lock.schemaVersion !== "blocky.upstream-core-lock/v1" || lock.repository !== "https://github.com/earendil-works/pi" || lock.tag !== "v0.86.0" || lock.commit !== "ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc" || lock.license !== "MIT" || lock.packages.length !== 2) throw Error("Pi upstream lock mismatch");
  const expected = ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"];
  for (const [index, entry] of lock.packages.entries()) {
    if (entry.name !== expected[index] || entry.version !== "0.86.0" || entry.license !== "MIT") throw Error("Pi package version mismatch");
    const files=index===0?["package.json","dist/index.js","dist/agent.js","dist/agent-loop.js","dist/stream-fn.js","dist/types.d.ts"]:["package.json","dist/utils/event-stream.js","dist/utils/text.js","dist/utils/transcript.js","dist/utils/validation.js"];
    if (JSON.stringify(entry.files.map(file=>file.path))!==JSON.stringify(files)) throw Error("Pi source coverage mismatch");
    const packageRoot = resolve(root, "packages/runtime-core/node_modules", entry.name);
    const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
    if (manifest.name !== entry.name || manifest.version !== entry.version || manifest.license !== entry.license) throw Error("Pi installed package mismatch");
    for (const file of entry.files) {
      if (!/^(package\.json|dist\/[A-Za-z0-9/_.-]+)$/.test(file.path) || file.path.split("/").includes("..")) throw Error("Pi lock path invalid");
      await verify(resolve(packageRoot, file.path), file);
    }
    if (entry.licenseFile.path !== `vendor/licenses/earendil-works-${entry.name.split("/")[1]}-0.86.0/LICENSE`) throw Error("Pi license path mismatch");
    await verify(resolve(root, entry.licenseFile.path), entry.licenseFile);
  }
  return lock;
}
async function verify(path, expected) {
  const bytes = await readFile(path);
  if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw Error("Pi source hash mismatch");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyPiCore();
  process.stdout.write("Pi core source and license lock verified\n");
}
