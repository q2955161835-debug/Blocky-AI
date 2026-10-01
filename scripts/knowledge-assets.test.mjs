import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ensureAsset, root, registry } from "./prepare-knowledge-model.mjs";

const text = Buffer.from("locked public model test bytes");
const asset = { name: "model.bin", bytes: text.length, sha256: createHash("sha256").update(text).digest("hex"), url: "https://example.invalid/model" };
async function temporary(fn) {
  const parent = join(root, "try/stage3/asset-tests");
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, "test-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true }); }
}
test("missing locked assets download once; verified files do not access network", () => temporary(async dir => {
  let calls = 0;
  const download = async () => { calls++; return new Response(text); };
  assert.equal(await ensureAsset(join(dir, "model.bin"), asset, download), "downloaded");
  assert.equal(await ensureAsset(join(dir, "model.bin"), asset, download), "verified");
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(join(dir, "model.bin")), text);
}));
test("bad download never publishes and removes its partial file", () => temporary(async dir => {
  await assert.rejects(ensureAsset(join(dir, "model.bin"), asset, async () => new Response(Buffer.alloc(text.length))), /checksum/);
  assert.deepEqual(await readdir(dir), []);
}));
test("corrupt existing asset fails without replacement or network", () => temporary(async dir => {
  await writeFile(join(dir, "model.bin"), "corrupt");
  await assert.rejects(ensureAsset(join(dir, "model.bin"), asset, async () => { throw Error("must not download"); }), /size mismatch/);
  assert.equal(await readFile(join(dir, "model.bin"), "utf8"), "corrupt");
}));
test("oversize response is bounded and leaves no final file", () => temporary(async dir => {
  await assert.rejects(ensureAsset(join(dir, "model.bin"), asset, async () => new Response(Buffer.alloc(text.length + 1))), /locked size/);
  assert.deepEqual(await readdir(dir), []);
}));
test("model lock fixes immutable URLs and runtime licenses", () => {
  assert.equal(registry.model.files.length, 5);
  assert(registry.model.files.every(asset => asset.url.includes(registry.model.revision) && /^[a-f0-9]{64}$/.test(asset.sha256)));
  assert.equal(registry.directml.version, "1.15.4");
  assert.equal(registry.vcRuntime.redistribution, "not bundled; installed system prerequisite");
});

test("linked model cache directories fail before network or publication", () => temporary(async dir => {
  const external=join(dir,"external"), linked=join(dir,"linked");
  await mkdir(external);
  await symlink(external,linked,process.platform==="win32" ? "junction" : "dir");
  let downloads=0;
  await assert.rejects(ensureAsset(join(linked,"model.bin"),asset,async()=>{downloads++;return new Response(text);}),/links/);
  assert.equal(downloads,0);
  assert.deepEqual(await readdir(external),[]);
}));
