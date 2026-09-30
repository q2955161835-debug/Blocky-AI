import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import { utf8, fail } from "./limits.mjs";
export async function docx(bytes, out) {
  let index = 0;
  const textOf = (n) =>
    n.type === "text" ? n.value : (n.children ?? []).map(textOf).join("");
  const walk = (node, path = "document") => {
    if (node.type === "paragraph") {
      index++;
      out.add(
        textOf(node),
        { paragraph: index },
        { part: "word/document.xml", path },
      );
    }
    (node.children ?? []).forEach((child, i) =>
      walk(child, `${path}/${child.type}[${i + 1}]`),
    );
  };
  await mammoth.convertToHtml(
    { buffer: bytes },
    {
      externalFileAccess: false,
      transformDocument: (document) => {
        walk(document);
        return document;
      },
    },
  );
}
function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("formula" in value || "sharedFormula" in value)
    return cellText(value.result);
  if (value.richText) return value.richText.map((v) => v.text).join("");
  if ("text" in value) return String(value.text);
  if ("error" in value) return String(value.error);
  return "";
}
export async function xlsx(bytes, out) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  if (book.worksheets.length > 50) fail("LIMIT");
  let count = 0;
  for (const sheet of book.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (++count > 100000) fail("LIMIT");
        const formula =
          typeof cell.value === "object" &&
          cell.value &&
          ("formula" in cell.value || "sharedFormula" in cell.value);
        out.add(
          cellText(cell.value),
          { sheet: sheet.name, cellRange: cell.address },
          {
            formulaEvaluated: "false",
            valueSource: formula ? "cached-formula" : "cell",
          },
        );
      }),
    );
}
export async function csv(bytes, out) {
  const text = utf8(bytes),
    parser = parse({ bom: true, info: true, max_record_size: 65536 });
  let row = 0;
  parser.end(text);
  try {
    for await (const item of parser) {
      row++;
      out.add(
        item.record.join("\t"),
        { row },
        { physicalEndLine: String(item.info.lines) },
      );
    }
  } catch (error) {
    if (error.code === "CSV_MAX_RECORD_SIZE") fail("LIMIT");
    throw error;
  }
}
