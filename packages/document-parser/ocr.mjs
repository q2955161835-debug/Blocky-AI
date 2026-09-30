import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { access } from "node:fs/promises";
import { createWorker } from "tesseract.js";
import { fail } from "./limits.mjs";
const require = createRequire(import.meta.url);
export function ocrSession(runtimeRoot) {
  let worker;
  return {
    async recognize(bytes, out, locator = {}) {
      if (!worker) {
        const langPath = resolve(runtimeRoot, "langs");
        try {
          await Promise.all(
            ["eng", "chi_sim"].map((lang) =>
              access(resolve(langPath, lang + ".traineddata.gz")),
            ),
          );
        } catch {
          fail("ASSET");
        }
        worker = await createWorker(["chi_sim", "eng"], 1, {
          langPath,
          gzip: true,
          cacheMethod: "none",
          corePath: dirname(require.resolve("tesseract.js-core/package.json")),
          workerPath: require.resolve(
            "tesseract.js/src/worker-script/node/index.js",
          ),
          logger: () => {},
          errorHandler: () => {},
        });
      }
      const { data } = await worker.recognize(
        bytes,
        {},
        { text: true, blocks: true },
      );
      for (const block of data.blocks ?? [])
        for (const paragraph of block.paragraphs ?? [])
          for (const line of paragraph.lines ?? []) {
            const b = line.bbox;
            out.add(
              line.text,
              {
                ...locator,
                region: {
                  x: b.x0,
                  y: b.y0,
                  width: b.x1 - b.x0,
                  height: b.y1 - b.y0,
                  unit: "pixel",
                },
              },
              { method: "ocr", confidence: String(line.confidence) },
            );
          }
    },
    async close() {
      if (worker) {
        await worker.terminate();
        worker = undefined;
      }
    },
  };
}
