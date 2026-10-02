"""Build the Blocky business plan in a copy of the approved Word template.

The source template package is read-only. Only its document body, font styles,
and document properties are updated in the output copy; the cover section,
true TOC field, section layout, headers, footers, and page-number fields remain.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"
DC_NS = "http://purl.org/dc/elements/1.1/"
CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
NS = {"w": W_NS}
TABLE_WIDTH_TWIPS = 8950  # A4 portrait, 1-inch margins, with a small safety inset.
FONT = "Noto Sans CJK SC"


def qn(local: str) -> str:
    return f"{{{W_NS}}}{local}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def add_child(parent: etree._Element, tag: str, **attrs: str) -> etree._Element:
    child = etree.SubElement(parent, qn(tag))
    for key, value in attrs.items():
        child.set(qn(key), value)
    return child


def clear_runs(paragraph: etree._Element) -> None:
    for child in list(paragraph):
        if child.tag != qn("pPr"):
            paragraph.remove(child)


def put_text(paragraph: etree._Element, value: str, *, font_size: float | None = None,
             bold: bool = False, center: bool = False) -> None:
    clear_runs(paragraph)
    ppr = paragraph.find(qn("pPr"))
    if ppr is None:
        ppr = etree.Element(qn("pPr"))
        paragraph.insert(0, ppr)
    if center:
        jc = ppr.find(qn("jc"))
        if jc is None:
            jc = etree.SubElement(ppr, qn("jc"))
        jc.set(qn("val"), "center")

    run = etree.SubElement(paragraph, qn("r"))

    parts = value.split("\n")
    for index, part in enumerate(parts):
        if index:
            etree.SubElement(run, qn("br"))
        text = etree.SubElement(run, qn("t"))
        if part.startswith(" ") or part.endswith(" "):
            text.set(f"{{{XML_NS}}}space", "preserve")
        text.text = part


def set_paragraph_style(paragraph: etree._Element, style_id: str) -> None:
    ppr = paragraph.find(qn("pPr"))
    if ppr is None:
        ppr = etree.Element(qn("pPr"))
        paragraph.insert(0, ppr)
    style = ppr.find(qn("pStyle"))
    if style is None:
        style = etree.Element(qn("pStyle"))
        ppr.insert(0, style)
    style.set(qn("val"), style_id)


def clone_paragraph(style_id: str, style_paragraphs: dict[str, etree._Element], text: str,
                    *, font_size: float | None = None, bold: bool = False,
                    center: bool = False, keep_next: bool = False) -> etree._Element:
    exemplar = style_paragraphs.get(style_id)
    paragraph = copy.deepcopy(exemplar) if exemplar is not None else etree.Element(qn("p"))
    set_paragraph_style(paragraph, style_id)
    put_text(paragraph, text, font_size=font_size, bold=bold, center=center)
    if keep_next:
        ppr = paragraph.find(qn("pPr"))
        keep = ppr.find(qn("keepNext"))
        if keep is None:
            etree.SubElement(ppr, qn("keepNext"))
    return paragraph


def twips_for_widths(widths: list[float] | None, count: int) -> list[int]:
    if widths is None or len(widths) != count:
        # Ratios are chosen for long labels while keeping totals inside A4 text width.
        defaults = {
            4: [0.92, 1.70, 1.60, 1.95],
            5: [3.05, 0.66, 0.66, 0.66, 1.16],
            6: [0.82, 0.63, 0.90, 0.90, 0.90, 2.00],
        }
        widths = defaults.get(count, [TABLE_WIDTH_TWIPS / 1440 / count] * count)
    total = sum(widths)
    scale = min(1.0, (TABLE_WIDTH_TWIPS / 1440) / total)
    result = [round(width * scale * 1440) for width in widths]
    result[-1] += TABLE_WIDTH_TWIPS - sum(result)
    return result


def table_cell(text: str, width: int, *, header: bool = False) -> etree._Element:
    cell = etree.Element(qn("tc"))
    tcpr = etree.SubElement(cell, qn("tcPr"))
    etree.SubElement(tcpr, qn("tcW"), {qn("w"): str(width), qn("type"): "dxa"})
    margins = etree.SubElement(tcpr, qn("tcMar"))
    for side, amount in (("top", "60"), ("start", "85"), ("bottom", "60"), ("end", "85")):
        etree.SubElement(margins, qn(side), {qn("w"): amount, qn("type"): "dxa"})
    paragraph = etree.SubElement(cell, qn("p"))
    ppr = etree.SubElement(paragraph, qn("pPr"))
    etree.SubElement(ppr, qn("pStyle"), {qn("val"): "BodyText"})
    etree.SubElement(ppr, qn("spacing"), {qn("before"): "0", qn("after"): "0", qn("line"): "220", qn("lineRule"): "auto"})
    numeric = bool(re.fullmatch(r"\(?[−-]?\d[\d,]*(?:\.\d+)?%?\)?", text.strip()))
    if not header and numeric:
        etree.SubElement(ppr, qn("jc"), {qn("val"): "right"})
    put_text(paragraph, text)
    return cell


def make_table(headers: list[str], rows: list[list[str]], widths: list[float] | None) -> etree._Element:
    if not headers or any(len(row) != len(headers) for row in rows):
        raise ValueError("A table row does not match its header width")
    widths_twips = twips_for_widths(widths, len(headers))
    table = etree.Element(qn("tbl"))
    tblpr = etree.SubElement(table, qn("tblPr"))
    etree.SubElement(tblpr, qn("tblStyle"), {qn("val"): "TableGrid"})
    etree.SubElement(tblpr, qn("tblW"), {qn("w"): str(TABLE_WIDTH_TWIPS), qn("type"): "dxa"})
    etree.SubElement(tblpr, qn("tblInd"), {qn("w"): "85", qn("type"): "dxa"})
    etree.SubElement(tblpr, qn("tblLayout"), {qn("type"): "fixed"})
    etree.SubElement(tblpr, qn("tblLook"), {
        qn("firstRow"): "1", qn("lastRow"): "0", qn("firstColumn"): "0",
        qn("lastColumn"): "0", qn("noHBand"): "1", qn("noVBand"): "1",
    })
    borders = etree.SubElement(tblpr, qn("tblBorders"))
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        etree.SubElement(borders, qn(side), {qn("val"): "single", qn("sz"): "4", qn("space"): "0", qn("color"): "000000"})
    etree.SubElement(tblpr, qn("tblCellMar"))
    grid = etree.SubElement(table, qn("tblGrid"))
    for width in widths_twips:
        etree.SubElement(grid, qn("gridCol"), {qn("w"): str(width)})

    all_rows = [headers, *rows]
    for row_index, values in enumerate(all_rows):
        row = etree.SubElement(table, qn("tr"))
        trpr = etree.SubElement(row, qn("trPr"))
        etree.SubElement(trpr, qn("cantSplit"))
        is_header = row_index == 0
        if is_header:
            etree.SubElement(trpr, qn("tblHeader"), {qn("val"): "true"})
        for text, width in zip(values, widths_twips):
            row.append(table_cell(str(text), width, header=is_header))
    return table


def format_number(value: Any) -> str:
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        if value.is_integer():
            return f"{int(value):,}"
        return f"{value:,.3f}".rstrip("0").rstrip(".")
    return str(value)


def money_wan(value: Any) -> str:
    amount = float(value) / 10_000
    formatted = f"{abs(amount):.3f}"
    return f"−{formatted}" if amount < 0 else formatted


def table_from_block(block: dict[str, Any], finance: dict[str, Any]) -> tuple[str, etree._Element]:
    kind = block["type"]
    if kind == "table":
        caption = str(block["caption"])
        match = re.search(r"Table\s*(\d+)", caption, re.IGNORECASE)
        if not match:
            raise ValueError(f"Table caption has no number: {caption}")
        number = int(match.group(1))
        title = caption.split(".", 1)[1].strip() if "." in caption else caption
        if number == 3:
            number = 4
        elif number == 4:
            number = 3
        headers = [str(value) for value in block["headers"]]
        rows = [[str(value) for value in row] for row in block["rows"]]
        return f"Table {number}. {title}", make_table(headers, rows, block.get("widths"))

    caption = str(block["caption"])
    match = re.search(r"Table\s*(\d+)", caption, re.IGNORECASE)
    if not match:
        raise ValueError(f"Financial table caption has no number: {caption}")
    number = int(match.group(1))
    title = caption.split(".", 1)[1].strip() if "." in caption else caption

    if kind == "finance_assumptions":
        rows = []
        for item in finance["assumptions"]:
            label = f"{item['id']} {item['label']}\n依据：{item['basis']}"
            rows.append([
                label,
                format_number(item["baseline"]),
                format_number(item["downside"]),
                format_number(item["upside"]),
                str(item["unit"]),
            ])
        return f"Table {number}. {title}", make_table([str(v) for v in block["columns"]], rows, None)

    if kind == "finance_scenarios":
        rows = []
        for scenario, values in finance["scenarios"].items():
            scenario_name = scenario.replace("情景", "")
            for year in values["years"]:
                rows.append([
                    scenario_name,
                    str(year["year"]),
                    money_wan(year["revenue"]),
                    money_wan(year["cost"]),
                    money_wan(year["net_income"]),
                    money_wan(year["ending_cash_before_additional_funding"]),
                ])
        return f"Table {number}. {title}", make_table([str(v) for v in block["columns"]], rows, None)

    if kind == "finance_funding":
        rows = []
        for scenario, values in finance["scenarios"].items():
            rows.append([
                scenario.replace("情景", ""),
                money_wan(values["peak_cash_deficit"]),
                str(values["peak_deficit_month"]),
                money_wan(values["required_additional_cash_with_reserve"]),
            ])
        return f"Table {number}. {title}", make_table([str(v) for v in block["columns"]], rows, None)

    raise ValueError(f"Unsupported block type: {kind}")


def set_style_fonts(styles_xml: bytes) -> bytes:
    root = etree.fromstring(styles_xml)
    for fonts in root.xpath(".//w:rFonts", namespaces=NS):
        for attribute in list(fonts.attrib):
            if etree.QName(attribute).localname.endswith("Theme"):
                del fonts.attrib[attribute]
        for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
            fonts.set(qn(attr), FONT)
    defaults = root.find(f"{qn('docDefaults')}/{qn('rPrDefault')}/{qn('rPr')}")
    if defaults is not None:
        fonts = defaults.find(qn("rFonts"))
        if fonts is None:
            fonts = etree.Element(qn("rFonts"))
            defaults.insert(0, fonts)
        for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
            fonts.set(qn(attr), FONT)
        for attribute in list(fonts.attrib):
            if etree.QName(attribute).localname.endswith("Theme"):
                del fonts.attrib[attribute]
        lang = defaults.find(qn("lang"))
        if lang is None:
            lang = etree.SubElement(defaults, qn("lang"))
        lang.set(qn("val"), "zh-CN")
        lang.set(qn("eastAsia"), "zh-CN")
    body_style = next(
        (style for style in root.xpath(".//w:style", namespaces=NS)
         if style.find("w:name", NS) is not None and style.find("w:name", NS).get(qn("val")) == "Body Text"),
        None,
    )
    if body_style is not None:
        ppr = body_style.find(qn("pPr"))
        if ppr is None:
            ppr = etree.SubElement(body_style, qn("pPr"))
        spacing = ppr.find(qn("spacing"))
        if spacing is None:
            spacing = etree.SubElement(ppr, qn("spacing"))
        spacing.set(qn("before"), "0")
        spacing.set(qn("after"), "120")
        spacing.set(qn("line"), "276")
        spacing.set(qn("lineRule"), "auto")
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def set_core_properties(core_xml: bytes, data: dict[str, Any]) -> bytes:
    root = etree.fromstring(core_xml)
    title = root.find(f"{{{DC_NS}}}title")
    if title is None:
        title = etree.SubElement(root, f"{{{DC_NS}}}title")
    title.text = data["title"]
    creator = root.find(f"{{{DC_NS}}}creator")
    if creator is None:
        creator = etree.SubElement(root, f"{{{DC_NS}}}creator")
    creator.text = data["organization"]
    modified_by = root.find(f"{{{CP_NS}}}lastModifiedBy")
    if modified_by is None:
        modified_by = etree.SubElement(root, f"{{{CP_NS}}}lastModifiedBy")
    modified_by.text = data["organization"]
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def iso_date(value: str) -> str:
    match = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", value)
    if match:
        year, month, day = (int(part) for part in match.groups())
        return f"{year:04d}-{month:02d}-{day:02d}"
    match = re.search(r"\d{4}-\d{2}-\d{2}", value)
    if not match:
        raise ValueError(f"Date is not in a recognized format: {value}")
    return match.group(0)


def update_header_xml(header_xml: bytes, data: dict[str, Any]) -> bytes:
    root = etree.fromstring(header_xml)
    text_nodes = root.xpath(".//w:t", namespaces=NS)
    if any(node.text == "Business plan" for node in text_nodes) and any(node.text == "[Business name]" for node in text_nodes):
        for node in text_nodes:
            if node.text == "Business plan":
                node.text = data["title"]
            elif node.text == "[Business name]":
                node.text = business_name(data)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def business_name(data: dict[str, Any]) -> str:
    title = str(data["title"])
    cleaned = re.sub(r"\s*商业计划书\s*$", "", title).strip()
    return cleaned or str(data["organization"])


def table_reference_text(text: str) -> str:
    def replacement(match: re.Match[str]) -> str:
        number = int(match.group(1))
        if number == 3:
            number = 4
        elif number == 4:
            number = 3
        return f"Table {number}（表{number}）"
    return re.sub(r"表([1-8])", replacement, text)


def build(template: Path, content_path: Path, finance_path: Path, output: Path) -> dict[str, Any]:
    data = json.loads(content_path.read_text(encoding="utf-8"))
    finance = json.loads(finance_path.read_text(encoding="utf-8"))
    if data.get("notesForFormatter"):
        # The note is intentionally not added to document text or metadata.
        pass
    source_hash = sha256(template)

    with zipfile.ZipFile(template, "r") as source_zip:
        document_xml = etree.fromstring(source_zip.read("word/document.xml"))
        style_xml = source_zip.read("word/styles.xml")
        core_xml = source_zip.read("docProps/core.xml")
        body = document_xml.find("w:body", NS)
        if body is None:
            raise ValueError("Template is missing w:body")

        style_paragraphs: dict[str, etree._Element] = {}
        for paragraph in body.findall("w:p", NS):
            style_id = paragraph.xpath("string(w:pPr/w:pStyle/@w:val)", namespaces=NS)
            if style_id and style_id not in style_paragraphs:
                style_paragraphs[style_id] = paragraph

        cover_map = {
            "DocumentHead": "商业计划书",
            "DocumentSubhead": business_name(data),
        }
        metadata_paragraphs = [
            f"Prepared for: {data['preparedFor']}",
            f"Document reference: {data['reference']}",
            f"Version: {data['version']}",
            f"Date produced: {iso_date(data['date'])}",
            f"Prepared by: {data['preparedBy']}",
            f"Confidential | {data['confidentiality']}",
        ]
        meta_index = 0
        for paragraph in body.findall("w:p", NS):
            style_id = paragraph.xpath("string(w:pPr/w:pStyle/@w:val)", namespaces=NS)
            if style_id in cover_map:
                put_text(paragraph, cover_map[style_id])
            elif style_id == "BodyText" and meta_index < len(metadata_paragraphs):
                # The first six BodyText paragraphs are the cover metadata.
                if paragraph.xpath(".//w:fldChar", namespaces=NS):
                    continue
                put_text(paragraph, metadata_paragraphs[meta_index])
                meta_index += 1
            elif paragraph.xpath(".//w:instrText[contains(., 'TOC')]", namespaces=NS):
                break

        subhead = next((p for p in body.findall("w:p", NS)
                        if p.xpath("string(w:pPr/w:pStyle/@w:val)", namespaces=NS) == "DocumentSubhead"), None)
        if subhead is None:
            raise ValueError("Template is missing its cover subtitle paragraph")
        english_subtitle = clone_paragraph("DocumentSubhead", style_paragraphs, "Business plan")
        body.insert(body.index(subhead) + 1, english_subtitle)
        subtitle = clone_paragraph("DocumentSubhead", style_paragraphs, str(data["subtitle"]))
        body.insert(body.index(subhead) + 2, subtitle)

        first_body_heading = None
        for child in body:
            if child.tag == qn("p") and child.xpath("string(w:pPr/w:pStyle/@w:val)", namespaces=NS) in {"Heading1", "Heading2", "Heading3"}:
                first_body_heading = child
                break
        if first_body_heading is None:
            raise ValueError("Could not locate the template's first body heading")
        final_sectpr = body.find(qn("sectPr"))
        if final_sectpr is None:
            raise ValueError("Template is missing final section properties")
        insertion_index = body.index(first_body_heading)
        for child in list(body)[insertion_index:]:
            if child is final_sectpr:
                continue
            body.remove(child)

        blocks = data.get("blocks", [])
        if not blocks:
            raise ValueError("Content JSON contains no blocks")
        counts: dict[str, int] = {}
        for block in blocks:
            kind = block["type"]
            counts[kind] = counts.get(kind, 0) + 1
            if kind == "h1":
                text = str(block["text"])
                node = clone_paragraph("Heading1", style_paragraphs, text)
                if text.startswith("Appendix "):
                    add_child(node.find(qn("pPr")), "pageBreakBefore")
            elif kind == "h2":
                node = clone_paragraph("Heading2", style_paragraphs, str(block["text"]))
            elif kind == "h3":
                node = clone_paragraph("Heading3", style_paragraphs, str(block["text"]))
            elif kind == "p":
                text = table_reference_text(str(block["text"]))
                node = clone_paragraph("BodyText", style_paragraphs, text)
            elif kind in {"table", "finance_assumptions", "finance_scenarios", "finance_funding"}:
                title, table = table_from_block(block, finance)
                title_node = clone_paragraph("Tabletitle", style_paragraphs, title, keep_next=True)
                body.insert(body.index(final_sectpr), title_node)
                body.insert(body.index(final_sectpr), table)
                continue
            else:
                raise ValueError(f"Unsupported content block type: {kind}")
            body.insert(body.index(final_sectpr), node)

        # The TOC field remains a real Word field and is refreshed by the renderer.
        for settings_part in ("word/settings.xml",):
            if settings_part in source_zip.namelist():
                settings = etree.fromstring(source_zip.read(settings_part))
                update = settings.find(qn("updateFields"))
                if update is None:
                    update = etree.SubElement(settings, qn("updateFields"))
                update.set(qn("val"), "true")
                settings_data = etree.tostring(settings, xml_declaration=True, encoding="UTF-8", standalone=True)
            else:
                settings_data = None

        replacements = {
            "word/document.xml": etree.tostring(document_xml, xml_declaration=True, encoding="UTF-8", standalone=True),
            "word/styles.xml": set_style_fonts(style_xml),
            "docProps/core.xml": set_core_properties(core_xml, data),
        }
        if settings_data is not None:
            replacements["word/settings.xml"] = settings_data
        for part_name in source_zip.namelist():
            if re.fullmatch(r"word/header\d+\.xml", part_name):
                replacements[part_name] = update_header_xml(source_zip.read(part_name), data)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as destination_zip:
            for item in source_zip.infolist():
                destination_zip.writestr(item, replacements.get(item.filename, source_zip.read(item.filename)))

    if sha256(template) != source_hash:
        raise RuntimeError("Source template changed while building output")
    return {
        "status": "ok",
        "template": str(template),
        "template_sha256_unchanged": source_hash,
        "content_json": str(content_path),
        "finance_summary_json": str(finance_path),
        "output": str(output),
        "output_sha256": sha256(output),
        "block_counts": counts,
        "table_count": counts.get("table", 0) + counts.get("finance_assumptions", 0) + counts.get("finance_scenarios", 0) + counts.get("finance_funding", 0),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True, type=Path, help="Read-only source DOCX template")
    parser.add_argument("--content", required=True, type=Path, help="Business plan content JSON")
    parser.add_argument("--finance", required=True, type=Path, help="finance-summary.json for dynamic tables")
    parser.add_argument("--output", required=True, type=Path, help="Output DOCX path below try/")
    parser.add_argument("--overwrite", action="store_true", help="Replace only the named output DOCX")
    args = parser.parse_args()

    template = args.template.expanduser().resolve(strict=True)
    content = args.content.expanduser().resolve(strict=True)
    finance = args.finance.expanduser().resolve(strict=True)
    output = args.output.expanduser().resolve()
    if template.suffix.casefold() != ".docx" or output.suffix.casefold() != ".docx":
        parser.error("--template and --output must be .docx paths")
    if output == template or not any(parent.name.casefold() == "try" for parent in (output, *output.parents)):
        parser.error("Output must be a different file below a directory named try")
    if output.exists() and not args.overwrite:
        parser.error("Output exists; use --overwrite to replace the named output file")
    output.parent.mkdir(parents=True, exist_ok=True)
    print(json.dumps(build(template, content, finance, output), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
