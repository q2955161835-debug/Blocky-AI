import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { manifestPath, verifyPackage } from "./package-input.mjs";
import { peImports } from "./pe-imports.mjs";
import { quoteNsis } from "../build-installer.mjs";

function image() {
  const b = Buffer.alloc(1024);
  b.write("MZ"); b.writeUInt32LE(128, 60); b.writeUInt32LE(0x4550, 128);
  b.writeUInt16LE(1, 134); b.writeUInt16LE(240, 148); b.writeUInt16LE(0x20b, 152);
  b.writeBigUInt64LE(0x140000000n, 176); b.writeUInt32LE(16, 260);
  b.writeUInt32LE(0x1000, 272); b.writeUInt32LE(40, 276);
  b.writeUInt32LE(0x1080, 368); b.writeUInt32LE(64, 372);
  b.writeUInt32LE(512, 400); b.writeUInt32LE(0x1000, 404); b.writeUInt32LE(512, 408); b.writeUInt32LE(512, 412);
  b.writeUInt32LE(0x1040, 524); b.write("VCRUNTIME140.dll\0", 576);
  b.writeUInt32LE(1, 640); b.writeUInt32LE(0x10c0, 644); b.write("KERNEL32.dll\0", 704);
  return b;
}
test("reads actual PE import and delay-import directories and rejects malformed addresses", () => {
  assert.deepEqual(peImports(image()), ["kernel32.dll", "vcruntime140.dll"]);
  const invalid = image(); invalid.writeUInt32LE(0xfffffff0, 60);
  assert.throws(() => peImports(invalid));
});
test("rejects path escapes, Windows alternate streams, reserved names and NSIS interpolation", () => {
  for (const path of ["../outside", "a/../b", "C:/file", "a\\b", "a:stream", "a\nfile", "a/CON.txt", "a/file.", "/root", "a//b"])
    assert.throws(() => manifestPath(path));
  assert.equal(manifestPath("builder/@scope/file.js"), "builder/@scope/file.js");
  assert.equal(quoteNsis('literal$INSTDIR"name'), '"literal$$INSTDIR$\\"name"');
});
test("pins exact package bytes and coverage and derives external VC requirements from PE", async () => {
  const base = resolve("try/installer-2026-10-09");
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(join(base, "test-"));
  try {
    const directory = join(root, "package"); await mkdir(directory);
    const bytes = image();
    await writeFile(join(directory, "Blocky Studio.exe"), bytes);
    const manifest = {directory: "package", files: [{path: "Blocky Studio.exe", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")}]};
    const file = join(root, "manifest.json"); await writeFile(file, JSON.stringify(manifest));
    const verified = await verifyPackage(directory, file, root);
    assert.deepEqual(verified.vcExternal, ["vcruntime140.dll"]);
    await writeFile(join(directory, "unknown.txt"), "unexpected");
    await assert.rejects(verifyPackage(directory, file, root), /Unlisted/);
    await rm(join(directory, "unknown.txt"));
    bytes[800] = 1; await writeFile(join(directory, "Blocky Studio.exe"), bytes);
    await assert.rejects(verifyPackage(directory, file, root), /mismatch/);
  } finally {
    const rel = relative(base, root);
    assert.ok(rel && !rel.startsWith(".."));
    await rm(root, {recursive: true});
  }
});
test("uninstaller retains profiles and unknown files and installer uses an independent HKCU beta identity", async () => {
  const source = await readFile(new URL("./beta.nsi", import.meta.url), "utf8");
  const uninstall = source.slice(source.indexOf('Section "Uninstall"'));
  assert.ok(source.includes("RequestExecutionLevel user"));
  assert.ok(source.includes('WriteRegStr HKCU "${BETA_UNINSTALL_KEY}"'));
  assert.ok(source.includes('Blocky Studio（测试版）.lnk'));
  assert.ok(!source.includes('Blocky Studio.lnk'));
  assert.ok(!/RMDir\s+\/r|Delete\s+.*\*/i.test(uninstall));
  assert.ok(!uninstall.includes("$LOCALAPPDATA"));
  assert.ok(!/WriteReg.*HKCR|\.blocky/.test(source));
});
