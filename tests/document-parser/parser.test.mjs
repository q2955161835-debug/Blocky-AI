import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser } from "../../packages/document-parser/index.mjs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { projectRoot } from "../../scripts/build-document-parser.mjs";
const require = createRequire(
  new URL("../../packages/document-parser/package.json", import.meta.url),
);
const JSZip = require("jszip");
const ExcelJS = require("exceljs");
const { PDFDocument } = require("pdf-lib");
async function zip(entries) {
  const z = new JSZip();
  for (const [k, v] of Object.entries(entries)) z.file(k, v);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
const fixture = (name) =>
  readFile(new URL("./fixtures/" + name, import.meta.url));
test("CSV produces logical rows, fixed source digest and text segments", async () => {
  const result = await createParser().parseBytes(
    Buffer.from('name,count\r\n"public, sample",3\r\n'),
    "csv",
  );
  assert.equal(result.schemaVersion, "blocky.document-result/v1");
  assert.match(result.sourceDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    result.segments.map((s) => s.locator.row),
    [1, 2],
  );
  assert.match(result.segments[1].text, /public, sample/);
});
test("strict UTF8, malformed files, unsupported extension and source limit reject safely", async () => {
  const parser = createParser();
  for (const [bytes, ext, code] of [
    [Buffer.from([0xff]), "csv", "UTF8"],
    [Buffer.from('"bad'), "csv", "INVALID"],
    [Buffer.from("bad"), "pdf", "INVALID"],
    [Buffer.from("bad"), "docx", "INVALID"],
    [Buffer.from("bad"), "exe", "FORMAT"],
    [Buffer.alloc(32 * 1024 * 1024 + 1), "csv", "LIMIT"],
  ]) {
    await assert.rejects(
      parser.parseBytes(bytes, ext),
      (e) => e.code === `BLK-DOCUMENT-${code}` && !e.message.includes("bad"),
    );
  }
});
test("ZIP rejects traversal, DTD, macros, external relationships, and compressed bombs", async () => {
  for (const entries of [
    { "word/document.xml": "<!DOCTYPE x><x/>" },
    { "word/vbaProject.bin": "x" },
    {
      "word/_rels/document.xml.rels":
        '<Relationship TargetMode="External" Target="https://private.invalid"/>',
    },
    { "word/document.xml": "A".repeat(2 * 1024 * 1024) },
  ]) {
    await assert.rejects(
      createParser().parseBytes(await zip(entries), "docx"),
      (e) => ["BLK-DOCUMENT-UNSAFE", "BLK-DOCUMENT-LIMIT"].includes(e.code),
    );
  }
});
test("DOCX paragraphs and table path, XLSX cells and cached formulas retain locators", async () => {
  const doc = await createParser().parseBytes(
    await fixture("public.docx"),
    "docx",
  );
  assert.equal(doc.segments[0].text, "中文段落一");
  assert.equal(doc.segments[2].locator.paragraph, 3);
  assert.match(doc.segments[2].metadata.path, /table/);
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("公开");
  s.getCell("A1").value = "苹果";
  s.getCell("B1").value = { formula: "1+2", result: 3 };
  const x = await createParser().parseBytes(
    Buffer.from(await wb.xlsx.writeBuffer()),
    "xlsx",
  );
  assert.deepEqual(
    x.segments.map((v) => v.locator.cellRange),
    ["A1", "B1"],
  );
  assert.equal(x.segments[1].text, "3");
  assert.equal(x.segments[1].metadata.formulaEvaluated, "false");
});
test("Chinese PDF text has page locators and does not need OCR assets", async () => {
  const r = await createParser({
    runtimeRoot: "D:/nonexistent-synthetic-runtime",
  }).parseBytes(await fixture("chinese-text.pdf"), "pdf");
  assert.match(r.segments[0].text, /中文文本测试/);
  assert.equal(r.segments[1].locator.page, 2);
});
test("CSV record and segment limits reject rather than truncate", async () => {
  await assert.rejects(
    createParser().parseBytes(Buffer.from("x".repeat(65537)), "csv"),
    (e) => e.code === "BLK-DOCUMENT-LIMIT",
  );
  await assert.rejects(
    createParser().parseBytes(Buffer.from("x\n".repeat(10001)), "csv"),
    (e) => e.code === "BLK-DOCUMENT-LIMIT",
  );
});
test("worker stdout is exactly one safe JSON line even when PDF parser warns", () => {
  const worker = new URL(
    "../../packages/document-parser/worker.mjs",
    import.meta.url,
  );
  const result = spawnSync(
    process.execPath,
    [
      worker.pathname.replace(/^\/([A-Z]:)/, "$1"),
      new URL("./fixtures/bad.pdf", import.meta.url).pathname.replace(
        /^\/([A-Z]:)/,
        "$1",
      ),
      "pdf",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.stdout.trim().split("\n").length, 1);
  assert.equal(JSON.parse(result.stdout).code, "BLK-DOCUMENT-INVALID");
  assert.equal(JSON.parse(result.stdout).schemaVersion, "blocky.document-error/v1");
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(),["code","schemaVersion"]);
  assert.equal(result.stderr, "");
});
test("ZIP rejects case-equivalent duplicate names and traversal entries", async () => {
  const { inspectZip } = await import("../../packages/document-parser/zip.mjs");
  await assert.rejects(
    inspectZip(await zip({ "word/a.xml": "x", "WORD/A.XML": "y" })),
    (e) => e.code === "BLK-DOCUMENT-UNSAFE",
  );
  await assert.rejects(
    inspectZip(await zip({ "../secret.xml": "x" })),
    (e) =>
      e.code === "BLK-DOCUMENT-INVALID" || e.code === "BLK-DOCUMENT-UNSAFE",
  );
});
test("oversized image header rejects before native decode or missing OCR assets", async () => {
  const bytes = Buffer.from(await fixture("ocr.png"));
  bytes.writeUInt32BE(100000, 16);
  bytes.writeUInt32BE(100000, 20);
  await assert.rejects(
    createParser().parseBytes(bytes, "png"),
    (e) => e.code === "BLK-DOCUMENT-LIMIT",
  );
});
test("scan PDF and PNG/JPEG/WebP yield actual Chinese/English OCR with pixel regions", async () => {
  const runtimeRoot = resolve(
    projectRoot,
    "try/agent-capability-upgrade/document-parser-tests/runtime",
  );
  await mkdir(resolve(runtimeRoot, "langs"), { recursive: true });
  for (const lang of ["eng", "chi_sim"])
    await copyFile(
      resolve(
        dirname(
          require.resolve("@tesseract.js-data/" + lang + "/package.json"),
        ),
        "4.0.0_best_int",
        lang + ".traineddata.gz",
      ),
      resolve(runtimeRoot, "langs", lang + ".traineddata.gz"),
    );
  const parser = createParser({ runtimeRoot }),
    png = await fixture("ocr.png");
  const { loadImage, createCanvas } = require("@napi-rs/canvas"),
    img = await loadImage(png),
    canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  for (const [bytes, ext] of [
    [await fixture("scanned.pdf"), "pdf"],
    [png, "png"],
    [canvas.toBuffer("image/jpeg"), "jpeg"],
    [canvas.toBuffer("image/webp"), "webp"],
  ]) {
    const r = await parser.parseBytes(bytes, ext),
      text = r.segments.map((s) => s.text).join("");
    assert.match(text, /BLOCKY OCR 12345/);
    assert.match(text.replace(/\s/g, ""), /中文测试/);
    assert(
      r.segments.every(
        (s) => s.locator.region.unit === "pixel" && s.locator.region.width > 0,
      ),
    );
    if (ext === "pdf") assert(r.segments.every((s) => s.locator.page === 1));
  }
});
test("PDF page, XLSX sheet, UTF16 XML and aggregate text caps reject", async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 201; i++) pdf.addPage([20, 20]);
  await assert.rejects(
    createParser().parseBytes(await pdf.save(), "pdf"),
    (e) => e.code === "BLK-DOCUMENT-LIMIT",
  );
  const wb = new ExcelJS.Workbook();
  for (let i = 0; i < 51; i++) wb.addWorksheet("sheet" + i);
  await assert.rejects(
    createParser().parseBytes(Buffer.from(await wb.xlsx.writeBuffer()), "xlsx"),
    (e) => e.code === "BLK-DOCUMENT-LIMIT",
  );
  await assert.rejects(
    createParser().parseBytes(
      await zip({
        "word/document.xml": Buffer.from("<!DOCTYPE x><x/>", "utf16le"),
      }),
      "docx",
    ),
    (e) => e.code === "BLK-DOCUMENT-UTF8",
  );
  await assert.rejects(
    createParser().parseBytes(
      Buffer.from(("x".repeat(1000) + "\n").repeat(9000)),
      "csv",
    ),
    (e) => e.code === "BLK-DOCUMENT-LIMIT",
  );
});
test("missing language assets fail safely and parseFile digest authenticates input bytes", async () => {
  await assert.rejects(
    createParser({
      runtimeRoot: resolve(
        projectRoot,
        "try/agent-capability-upgrade/document-parser-tests/missing",
      ),
    }).parseBytes(await fixture("ocr.png"), "png"),
    (e) => e.code === "BLK-DOCUMENT-ASSET",
  );
  const path = new URL("./fixtures/public.docx", import.meta.url);
  const { fileURLToPath } = await import("node:url");
  const file = await createParser().parseFile(fileURLToPath(path), "docx"),
    bytes = await createParser().parseBytes(
      await fixture("public.docx"),
      "docx",
    );
  assert.deepEqual(file, bytes);
});
