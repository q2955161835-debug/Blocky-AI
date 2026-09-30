import yauzl from "yauzl";
import { LIMITS, DocumentError, utf8 } from "./limits.mjs";
// Inspect actual inflated bytes without extracting files before Office parsers run.
export function inspectZip(bytes) {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error) return reject(new DocumentError("INVALID"));
        let entries = 0,
          total = 0,
          settled = false;
        const names = new Set();
        const stop = (kind) => {
          if (settled) return;
          settled = true;
          zip.close();
          reject(new DocumentError(kind));
        };
        zip.on("error", () => stop("INVALID"));
        zip.on("end", () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        });
        zip.on("entry", (entry) => {
          const name = entry.fileName,
            key = name.toLowerCase(),
            mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (
            ++entries > LIMITS.zipEntries ||
            entry.uncompressedSize > LIMITS.zipEntry ||
            entry.uncompressedSize > 100 * Math.max(1, entry.compressedSize)
          )
            return stop("LIMIT");
          if (
            names.has(key) ||
            name.includes("\\") ||
            name.includes("\0") ||
            name.startsWith("/") ||
            /^[a-z]:/i.test(name) ||
            name.split("/").some((v) => v === ".." || v === ".") ||
            entry.generalPurposeBitFlag & 1 ||
            mode === 0xa000 ||
            /vba|macros|embeddings/i.test(name)
          )
            return stop("UNSAFE");
          names.add(key);
          if (name.endsWith("/")) return zip.readEntry();
          zip.openReadStream(entry, (err, stream) => {
            if (err) return stop("INVALID");
            let count = 0;
            const xml = /\.(xml|rels)$/i.test(name),
              chunks = [];
            stream.on("error", () => stop("INVALID"));
            stream.on("data", (chunk) => {
              count += chunk.length;
              total += chunk.length;
              if (count > LIMITS.zipEntry || total > LIMITS.zipTotal) {
                stream.destroy();
                return stop("LIMIT");
              }
              if (xml) chunks.push(chunk);
            });
            stream.on("end", () => {
              if (settled) return;
              if (count !== entry.uncompressedSize) return stop("INVALID");
              if (xml) {
                let text;
                try {
                  text = utf8(Buffer.concat(chunks));
                } catch {
                  return stop("UTF8");
                }
                if (
                  text.includes("\0") ||
                  /encoding\s*=\s*['"](?!utf-8['"]|UTF-8['"])/.test(text)
                )
                  return stop("UTF8");
                if (
                  /<!\s*(DOCTYPE|ENTITY)\b/i.test(text) ||
                  /macroEnabled|vbaProject/i.test(text)
                )
                  return stop("UNSAFE");
                if (
                  /\.rels$/i.test(name) &&
                  (/\bTargetMode\s*=\s*['"]\s*External\s*['"]/i.test(text) ||
                    /\bTarget\s*=\s*['"]\s*(?:[a-z][a-z0-9+.-]*:|\/\/|\\)/i.test(
                      text,
                    ) ||
                    /&#(?:x[0-9a-f]+|[0-9]+);/i.test(text))
                )
                  return stop("UNSAFE");
              }
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
}
