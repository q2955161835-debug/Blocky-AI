import { createHash } from "node:crypto";

const canvasPath = "try/agent-capability-upgrade/document-runtime/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node";
const canvasSha256 = "4aed9a37c05f174f1b0f3ffee665b76b6b69404e8a1bdd1ade2b281d0e90ff7e";
// This path is present in the npm-published 0.1.88 binary, before our build.
// Keep its bytes and runtime lock unchanged; recognize only this exact asset.
const upstreamPrefix = "C:\\Users\\runneradmin\\.cargo\\registry\\src\\index.crates.io-1949cf8c6b5b557f\\";

export function scanLocalBuildPaths(bytes, prefixes, path) {
  const pinnedCanvas = path === canvasPath && bytes.length === 28187136 &&
    createHash("sha256").update(bytes).digest("hex") === canvasSha256;
  let localBuildPath = false, upstreamPathFound = false;
  for (const prefix of prefixes.filter(Boolean)) {
    for (const encoding of ["utf8", "utf16le"]) {
      const needle = Buffer.from(prefix, encoding);
      const upstream = Buffer.from(upstreamPrefix, encoding);
      for (let offset = bytes.indexOf(needle); offset !== -1; offset = bytes.indexOf(needle, offset + needle.length)) {
        if (pinnedCanvas && upstream.subarray(0, needle.length).equals(needle) &&
            bytes.subarray(offset, offset + upstream.length).equals(upstream)) {
          upstreamPathFound = true;
        } else {
          localBuildPath = true;
        }
      }
    }
  }
  return { localBuildPath, upstreamBuildPaths: upstreamPathFound ? [
    "@napi-rs/canvas-win32-x64-msvc@0.1.88: pinned upstream Cargo registry path",
  ] : [] };
}
