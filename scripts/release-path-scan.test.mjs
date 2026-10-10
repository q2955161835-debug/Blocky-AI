import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { scanLocalBuildPaths } from "./release-path-scan.mjs";

const canvasPath = "try/agent-capability-upgrade/document-runtime/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node";
const prefixes = ["D:\\a\\Blocky-AI\\Blocky-AI", "C:\\Users\\runneradmin"];
let nativePath = process.env.BLOCKY_CANVAS_SCAN_FIXTURE;
if (!nativePath) {
  try {
    const require = createRequire(new URL("../packages/document-parser/package.json", import.meta.url));
    const canvasRequire = createRequire(require.resolve("@napi-rs/canvas/package.json"));
    nativePath = canvasRequire.resolve("@napi-rs/canvas-win32-x64-msvc");
  } catch {}
}

const nativeSkip = !nativePath && process.platform !== "win32";
test("recognizes upstream runner paths in the exact pinned Windows Canvas binary", { skip: nativeSkip }, async () => {
  const bytes = await readFile(nativePath);
  const result = scanLocalBuildPaths(bytes, prefixes, canvasPath);
  assert.equal(result.localBuildPath, false);
  assert.equal(result.upstreamBuildPaths.length, 1);
  assert.match(result.upstreamBuildPaths[0], /canvas.*0\.1\.88/);
});

test("still detects current build paths in UTF-8 and UTF-16 ordinary artifacts", () => {
  for (const encoding of ["utf8", "utf16le"]) {
    const bytes = Buffer.from("C:\\Users\\runneradmin\\private-project\\source.rs", encoding);
    assert.equal(scanLocalBuildPaths(bytes, prefixes, "blocky-studio.exe").localBuildPath, true);
    assert.equal(scanLocalBuildPaths(bytes, prefixes, canvasPath).localBuildPath, true);
  }
  assert.equal(scanLocalBuildPaths(Buffer.from("D:\\a\\Blocky-AI\\Blocky-AI\\src\\lib.rs"), prefixes, "blocky-studio.exe").localBuildPath, true);
});

test("does not apply upstream provenance to another file or changed vendor bytes", { skip: nativeSkip }, async () => {
  const bytes = await readFile(nativePath);
  assert.equal(scanLocalBuildPaths(bytes, prefixes, "blocky-studio.exe").localBuildPath, true);
  bytes[0] ^= 1;
  const result = scanLocalBuildPaths(bytes, prefixes, canvasPath);
  assert.equal(result.localBuildPath, true);
  assert.deepEqual(result.upstreamBuildPaths, []);
});

test("accepts remapped production paths", () => {
  assert.deepEqual(scanLocalBuildPaths(Buffer.from("/build/src/lib.rs"), prefixes, "blocky-studio.exe"), {
    localBuildPath: false, upstreamBuildPaths: [],
  });
});
