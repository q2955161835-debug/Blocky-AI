import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LIMITS, SCHEMA, DocumentError, collector, fail } from "./limits.mjs";
import { inspectZip } from "./zip.mjs";
import { docx, xlsx, csv } from "./office.mjs";
import { pdf, image } from "./pdf.mjs";
import { ocrSession } from "./ocr.mjs";
const defaultRuntimeRoot = fileURLToPath(
  new URL("./runtime/", import.meta.url),
);
export function createParser({ runtimeRoot = defaultRuntimeRoot } = {}) {
  async function parseBytes(input, extension) {
    if (!(input instanceof Uint8Array)) fail("INVALID");
    if (input.byteLength > LIMITS.source) fail("LIMIT");
    if (
      !["pdf", "docx", "xlsx", "csv", "png", "jpg", "jpeg", "webp"].includes(
        extension,
      )
    )
      fail("FORMAT");
    // Stable snapshot also avoids PDF transfer detaching the caller's bytes.
    const bytes = Buffer.from(input),
      sourceDigest = createHash("sha256").update(bytes).digest("hex"),
      out = collector(),
      ocr = ocrSession(runtimeRoot);
    try {
      if (extension === "docx" || extension === "xlsx") await inspectZip(bytes);
      if (extension === "docx") await docx(bytes, out);
      else if (extension === "xlsx") await xlsx(bytes, out);
      else if (extension === "csv") await csv(bytes, out);
      else if (extension === "pdf") await pdf(bytes, out, ocr);
      else await image(bytes, out, ocr);
      return { schemaVersion: SCHEMA, sourceDigest, segments: out.segments };
    } catch (error) {
      if (error instanceof DocumentError) throw error;
      fail("INVALID");
    } finally {
      await ocr.close();
    }
  }
  async function parseFile(path, extension) {
    let handle;
    try {
      handle = await open(path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) fail("INVALID");
      if (stat.size > LIMITS.source) fail("LIMIT");
      // Bound actual reads as well as stat so a growing input cannot allocate freely.
      const chunks = [];
      let total = 0;
      for (;;) {
        const buffer = Buffer.alloc(65536),
          { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > LIMITS.source) fail("LIMIT");
        chunks.push(buffer.subarray(0, bytesRead));
      }
      return await parseBytes(Buffer.concat(chunks, total), extension);
    } catch (error) {
      if (error instanceof DocumentError) throw error;
      fail("IO");
    } finally {
      await handle?.close();
    }
  }
  return { parseBytes, parseFile };
}
export const parseBytes = (bytes, extension) =>
  createParser().parseBytes(bytes, extension);
export const parseFile = (path, extension) =>
  createParser().parseFile(path, extension);
export { DocumentError, LIMITS, SCHEMA };
