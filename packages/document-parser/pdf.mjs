import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { LIMITS, fail } from "./limits.mjs";
import { imageSize } from "./image-header.mjs";
const require = createRequire(import.meta.url),
  assets = dirname(require.resolve("pdfjs-dist/package.json"));
export async function image(bytes, out, ocr) {
  imageSize(bytes);
  const decoded = await loadImage(bytes);
  if (
    !Number.isFinite(decoded.width * decoded.height) ||
    decoded.width * decoded.height > LIMITS.pixels
  )
    fail("LIMIT");
  await ocr.recognize(bytes, out);
}
export async function pdf(bytes, out, ocr) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
    cMapUrl: resolve(assets, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: resolve(assets, "standard_fonts") + "/",
    wasmUrl: resolve(assets, "wasm") + "/",
  });
  let document;
  try {
    document = await task.promise;
    if (document.numPages > LIMITS.pages) fail("LIMIT");
    for (let page = 1; page <= document.numPages; page++) {
      const p = await document.getPage(page);
      try {
        const content = await p.getTextContent(),
          text = content.items
            .filter((v) => "str" in v)
            .map((v) => v.str + (v.hasEOL ? "\n" : " "))
            .join("")
            .trim();
        if (text) {
          out.add(text, { page }, { method: "pdf-text" });
          continue;
        }
        const ops = await p.getOperatorList(),
          imageOps = new Set([
            pdfjs.OPS.paintImageXObject,
            pdfjs.OPS.paintInlineImageXObject,
            pdfjs.OPS.paintImageMaskXObject,
            pdfjs.OPS.paintImageXObjectRepeat,
            pdfjs.OPS.paintImageMaskXObjectRepeat,
            pdfjs.OPS.paintInlineImageXObjectGroup,
          ]);
        if (!ops.fnArray.some((op) => imageOps.has(op))) continue;
        const viewport = p.getViewport({ scale: 2 }),
          width = Math.ceil(viewport.width),
          height = Math.ceil(viewport.height);
        if (
          !Number.isFinite(width * height) ||
          width <= 0 ||
          height <= 0 ||
          width * height > LIMITS.pixels
        )
          fail("LIMIT");
        const canvas = createCanvas(width, height);
        await p.render({
          canvas,
          canvasContext: canvas.getContext("2d"),
          viewport,
        }).promise;
        await ocr.recognize(canvas.toBuffer("image/png"), out, { page });
      } finally {
        p.cleanup();
      }
    }
  } finally {
    if (document) await document.destroy();
    else await task.destroy();
  }
}
