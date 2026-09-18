import { createHash } from "node:crypto";
import type { ConversionCall } from "../../packages/conversion-core/src/scan";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export async function conversionFixture(
  source = "function double(x: number): number { return x * 2; }\nexport function flow(x: number): number { return double(x) + 3; }",
) {
  const contents = {
    "math.ts": source,
    LICENSE:
      'MIT License\nCopyright 2026 Blocky test fixture\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the Software), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  };
  const files = Object.entries(contents).map(([path, content]) => ({
    path,
    content,
    sha256: sha(content),
    bytes: Buffer.byteLength(content),
  }));
  const artifact = {
    artifactId: `art-${sha(JSON.stringify(files))}`,
    sha256: sha(source),
    bytes: Buffer.byteLength(JSON.stringify(files)),
    snapshotId: `snap-${sha(source)}`,
    commit: "a".repeat(40),
    fileCount: files.length,
    subdir: "",
    repository: "local-repository" as const,
    dirty: "false" as const,
    excludedCount: 0,
  };
  const page = {
    ...artifact,
    schemaVersion: "blocky.source-snapshot/v1",
    readPolicy: "locked-commit",
    dirtyScope: "test tracked files",
    dirtyChecked: files.length,
    dirtyChanged: 0,
    dirtyUnchecked: 0,
    files,
    excluded: [],
    excludedTruncated: false,
    nextCursor: null,
  };
  let saved: { value: unknown; analysisCache: unknown } = {
    value: null,
    analysisCache: null,
  };
  const call: ConversionCall = async (operation, fields) => {
    if (operation === "conversion-scan") return structuredClone(artifact);
    if (operation === "conversion-read") return structuredClone(page);
    if (operation === "conversion-cache-load") return structuredClone(saved);
    if (operation === "conversion-cache-save") {
      saved = { value: fields.value, analysisCache: fields.analysisCache };
      return {};
    }
    if (operation === "conversion-cancel") return { cancelled: true };
    throw Error("unexpected conversion call");
  };
  return { artifact, page, call };
}
