export const SCHEMA = "blocky.document-result/v1";
export const LIMITS = Object.freeze({
  source: 32 * 1024 * 1024,
  text: 8 * 1024 * 1024,
  segment: 64 * 1024,
  segments: 10000,
  pages: 200,
  pixels: 16000000,
  zipEntries: 4096,
  zipEntry: 16 * 1024 * 1024,
  zipTotal: 64 * 1024 * 1024,
});
export class DocumentError extends Error {
  constructor(kind) {
    super(`BLK-DOCUMENT-${kind}`);
    this.code = this.message;
  }
}
export function fail(kind) {
  throw new DocumentError(kind);
}
export function utf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("UTF8");
  }
}
export function collector() {
  let size = 0;
  const segments = [];
  return {
    segments,
    add(text, locator, metadata = {}) {
      text = String(text).trim();
      if (!text) return;
      const bytes = Buffer.byteLength(text);
      size += bytes;
      if (
        bytes > LIMITS.segment ||
        size > LIMITS.text ||
        segments.length >= LIMITS.segments
      )
        fail("LIMIT");
      if (Object.values(metadata).some((v) => typeof v !== "string"))
        fail("INVALID");
      segments.push({ text, locator, metadata });
    },
  };
}
