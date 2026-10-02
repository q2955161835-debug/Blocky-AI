#!/usr/bin/env python3
"""Validate a final Word deliverable against the skill's mandatory standard."""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from lxml import etree


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W_NS, "r": R_NS, "pr": PKG_REL_NS}
W = f"{{{W_NS}}}"
R = f"{{{R_NS}}}"

APPROVED_STYLES = {
    "Body Text",
    "Document Head",
    "Document Subhead",
    "Footer",
    "Header",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Hyperlink",
    "Normal",
    "Strong",
    "Table Grid",
    "Table title",
    "TOC Heading",
    "toc 1",
    "toc 2",
    "toc 3",
}
CANONICAL_STYLE_NAMES = {name.casefold(): name for name in APPROVED_STYLES}

BANNED_PATTERNS = {
    "In today's fast-paced business environment": r"\bin today(?:'|’)s fast-paced business environment\b",
    "It's worth noting that": r"\bit(?:'|’)s worth noting that\b",
    "In an era of": r"\bin an era of\b",
    "As organizations increasingly": r"\bas organi[sz]ations increasingly\b",
    "Furthermore": r"\bfurthermore\b",
    "Moreover": r"\bmoreover\b",
    "Additionally": r"\badditionally\b",
    "Overall": r"\boverall\b",
    "In conclusion": r"\bin conclusion\b",
    "delve": r"\bdelv(?:e|es|ed|ing)\b",
    "leverage": r"\bleverag(?:e|es|ed|ing)\b",
    "robust": r"\brobust\b",
    "seamless": r"\bseamless(?:ly)?\b",
    "holistic": r"\bholistic(?:ally)?\b",
    "landscape": r"\blandscape\b",
    "ecosystem": r"\becosystem\b",
    "unlock": r"\bunlock(?:s|ed|ing)?\b",
    "harness": r"\bharness(?:es|ed|ing)?\b",
    "navigate the complexities": r"\bnavigate(?:s|d|ing)? the complexities\b",
    "drive value": r"\bdriv(?:e|es|ing|en) value\b",
    "at the end of the day": r"\bat the end of the day\b",
    "journey": r"\bjourney\b",
    "best-in-class": r"\bbest-in-class\b",
    "game-changing": r"\bgame-changing\b",
    "transformative": r"\btransformative\b",
    "key": r"\bkey\b",
    "may potentially": r"\bmay potentially\b",
    "could possibly help to": r"\bcould possibly help to\b",
    "This section will explore": r"\bthis section will explore\b",
    "The following outlines": r"\bthe following outlines\b",
}

PLACEHOLDER_PATTERNS = {
    "business-name placeholder": r"\[Business name\]",
    "date placeholder": r"\[YYYY-MM-DD\]",
    "client placeholder": r"\[Client or organisation\]",
    "reference placeholder": r"\[Reference\]",
    "preparer placeholder": r"\[Name or organisation\]",
    "template placeholder": r"\bYour text here\b",
    "drafting guidance": r"\bDrafting guidance\b",
    "TOC placeholder": r"\bUpdate this field in Word\b",
}


@dataclass(frozen=True)
class Finding:
    location: str
    detail: str


@dataclass
class ParagraphRecord:
    index: int
    element: etree._Element
    text: str
    style_id: str
    style_name: str
    is_heading: bool
    is_list: bool
    list_level: int


class Report:
    def __init__(self) -> None:
        self.failures: dict[str, list[Finding]] = defaultdict(list)
        self.notes: list[str] = []

    def fail(self, check: str, location: str, detail: str) -> None:
        self.failures[check].append(Finding(location, detail))

    def passed(self, check: str) -> bool:
        return not self.failures.get(check)

    def print(self, checks: list[str]) -> None:
        for check in checks:
            findings = self.failures.get(check, [])
            if findings:
                print(f"FAIL: {check} ({len(findings)} finding(s))")
                for finding in findings:
                    print(f"  - {finding.location}: {finding.detail}")
            else:
                print(f"PASS: {check}")
        for note in self.notes:
            print(f"INFO: {note}")


def parse_xml(data: bytes, part: str) -> etree._Element:
    try:
        return etree.fromstring(data)
    except etree.XMLSyntaxError as exc:
        raise ValueError(f"Invalid XML in {part}: {exc}") from exc


def element_text(element: etree._Element) -> str:
    return "".join(element.xpath(".//w:t/text()", namespaces=NS)).strip()


def identity_key(value: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", value.casefold())


def style_maps(styles_root: etree._Element) -> tuple[dict[str, str], dict[str, etree._Element]]:
    names: dict[str, str] = {}
    elements: dict[str, etree._Element] = {}
    for style in styles_root.xpath(".//w:style", namespaces=NS):
        style_id = style.get(f"{W}styleId", "")
        name_element = style.find("w:name", NS)
        name = name_element.get(f"{W}val", style_id) if name_element is not None else style_id
        name = CANONICAL_STYLE_NAMES.get(name.casefold(), name)
        names[style_id] = name
        elements[style_id] = style
    return names, elements


def paragraph_records(document_root: etree._Element, style_names: dict[str, str]) -> list[ParagraphRecord]:
    records: list[ParagraphRecord] = []
    for index, paragraph in enumerate(document_root.xpath(".//w:body//w:p", namespaces=NS), 1):
        style_element = paragraph.find("w:pPr/w:pStyle", NS)
        style_id = style_element.get(f"{W}val", "Normal") if style_element is not None else "Normal"
        style_name = style_names.get(style_id, style_id)
        num_pr = paragraph.find("w:pPr/w:numPr", NS)
        list_level = 0
        if num_pr is not None:
            level = num_pr.find("w:ilvl", NS)
            if level is not None:
                list_level = int(level.get(f"{W}val", "0"))
        is_list = num_pr is not None or style_name.lower().startswith("list ")
        records.append(
            ParagraphRecord(
                index=index,
                element=paragraph,
                text=element_text(paragraph),
                style_id=style_id,
                style_name=style_name,
                is_heading=style_name.startswith("Heading "),
                is_list=is_list,
                list_level=list_level,
            )
        )
    return records


def check_colour_and_graphics(parts: dict[str, bytes], report: Report) -> None:
    allowed_text = {None, "auto", "000000", "00000000"}
    allowed_fill = {None, "auto", "FFFFFF", "ffffff"}
    allowed_border = {None, "auto", "000000", "00000000"}
    for part, data in parts.items():
        if not part.startswith("word/") or not part.endswith(".xml"):
            continue
        root = parse_xml(data, part)
        for element in root.xpath(".//w:color", namespaces=NS):
            value = element.get(f"{W}val")
            if value not in allowed_text:
                report.fail("Black-and-white formatting", part, f"coloured text value {value}")
        for element in root.xpath(".//w:shd", namespaces=NS):
            value = element.get(f"{W}fill")
            if value not in allowed_fill:
                report.fail("Black-and-white formatting", part, f"shading or fill value {value}")
        for element in root.xpath(".//w:highlight", namespaces=NS):
            value = element.get(f"{W}val")
            if value not in {None, "none"}:
                report.fail("Black-and-white formatting", part, f"highlight value {value}")
        for border in root.xpath(".//w:tblBorders/* | .//w:tcBorders/* | .//w:pBdr/*", namespaces=NS):
            value = border.get(f"{W}color")
            if value not in allowed_border:
                report.fail("Black-and-white formatting", part, f"coloured border value {value}")
        for element in root.xpath(".//*[@w:themeColor or @w:themeFill or @w:highlight]", namespaces=NS):
            report.fail("Black-and-white formatting", part, "theme colour, theme fill, or highlight attribute remains")
        drawings = root.xpath(".//w:drawing | .//w:pict | .//w:object", namespaces=NS)
        if drawings:
            report.fail("Black-and-white formatting", part, f"{len(drawings)} drawing or embedded graphic object(s)")
    theme_parts = [part for part in parts if part.startswith("word/theme/")]
    for part in theme_parts:
        report.fail("Black-and-white formatting", part, "theme part remains in the package")


def check_fonts(styles_root: etree._Element, document_root: etree._Element, parts: dict[str, bytes], report: Report) -> None:
    fonts: set[str] = set()
    theme_fonts: list[str] = []
    roots = [("word/styles.xml", styles_root), ("word/document.xml", document_root)]
    for part in (name for name in parts if re.fullmatch(r"word/(header|footer)\d+\.xml", name)):
        roots.append((part, parse_xml(parts[part], part)))
    for part, root in roots:
        for element in root.xpath(".//w:rFonts", namespaces=NS):
            for attr, value in element.attrib.items():
                local = etree.QName(attr).localname
                if local.endswith("Theme"):
                    theme_fonts.append(f"{part}:{local}")
                elif local in {"ascii", "hAnsi", "eastAsia", "cs"} and value:
                    fonts.add(value.casefold())
    if theme_fonts:
        report.fail("Typeface and paragraph styling", theme_fonts[0], "theme font reference remains")
    if len(fonts) > 1:
        report.fail("Typeface and paragraph styling", "Word styles", f"multiple typefaces found: {', '.join(sorted(fonts))}")
    elif fonts and fonts != {"arial"}:
        report.fail("Typeface and paragraph styling", "Word styles", f"expected Arial, found {', '.join(sorted(fonts))}")

    body_style = next(
        (
            style
            for style in styles_root.xpath(".//w:style", namespaces=NS)
            if (style.find("w:name", NS) is not None)
            and style.find("w:name", NS).get(f"{W}val") == "Body Text"
        ),
        None,
    )
    if body_style is None:
        report.fail("Typeface and paragraph styling", "word/styles.xml", "Body Text style is missing")
        return
    size = body_style.find("w:rPr/w:sz", NS)
    spacing = body_style.find("w:pPr/w:spacing", NS)
    if size is None or size.get(f"{W}val") != "22":
        report.fail("Typeface and paragraph styling", "Body Text style", "body size is not 11 points")
    if spacing is None or spacing.get(f"{W}after") != "120":
        report.fail("Typeface and paragraph styling", "Body Text style", "space after is not 6 points")
    if spacing is None or spacing.get(f"{W}line") not in {"276", "277"}:
        report.fail("Typeface and paragraph styling", "Body Text style", "line spacing is not 1.15")


def check_page_setup(document_root: etree._Element, report: Report) -> list[etree._Element]:
    sections = document_root.xpath(".//w:sectPr", namespaces=NS)
    if len(sections) < 2:
        report.fail("Page architecture", "word/document.xml", "cover and body do not use separate sections")
    for index, section in enumerate(sections, 1):
        size = section.find("w:pgSz", NS)
        margins = section.find("w:pgMar", NS)
        width = int(size.get(f"{W}w", "0")) if size is not None else 0
        height = int(size.get(f"{W}h", "0")) if size is not None else 0
        if not (11890 <= width <= 11920 and 16820 <= height <= 16855):
            report.fail("Page architecture", f"section {index}", f"page size is not A4: {width} by {height} twips")
        if margins is None:
            report.fail("Page architecture", f"section {index}", "page margins are missing")
        else:
            for side in ("top", "right", "bottom", "left"):
                value = int(margins.get(f"{W}{side}", "0"))
                if not 1435 <= value <= 1445:
                    report.fail("Page architecture", f"section {index}", f"{side} margin is {value} twips, not 2.54 cm")
    return sections


def check_cover_and_filename(
    path: Path,
    records: list[ParagraphRecord],
    template_mode: bool,
    report: Report,
) -> tuple[str, str]:
    first_section_break = next(
        (i for i, record in enumerate(records) if record.element.find("w:pPr/w:sectPr", NS) is not None),
        min(10, len(records)),
    )
    cover_text = "\n".join(record.text for record in records[: first_section_break + 1] if record.text)
    required = {
        "document title": r"\bbusiness plan\b",
        "prepared for": r"\bPrepared for:\s*\S",
        "document reference": r"\bDocument reference:\s*\S",
        "version": r"\bVersion:\s*\S",
        "production date": r"\bDate produced:\s*\d{4}-\d{2}-\d{2}",
        "prepared by": r"\bPrepared by:\s*\S",
        "confidentiality": r"\bConfidential\b",
    }
    if template_mode:
        required["production date"] = r"\bDate produced:\s*(?:\[YYYY-MM-DD\]|\d{4}-\d{2}-\d{2})"
    for label, pattern in required.items():
        if not re.search(pattern, cover_text, flags=re.IGNORECASE):
            report.fail("Cover and file identity", "cover", f"missing or incomplete {label}")

    business_name = ""
    for record in records[: first_section_break + 1]:
        if record.style_name == "Document Subhead" and record.text:
            business_name = record.text
            break
    if not business_name:
        report.fail("Cover and file identity", "cover", "business name styled as Document Subhead is missing")
    date_match = re.search(r"Date produced:\s*(\d{4}-\d{2}-\d{2})", cover_text, flags=re.IGNORECASE)
    date_text = date_match.group(1) if date_match else ""
    if not template_mode:
        if not date_text or date_text not in path.stem:
            report.fail("Cover and file identity", path.name, "production date is missing from the filename or differs from the cover")
        if business_name and identity_key(business_name) not in identity_key(path.stem):
            report.fail("Cover and file identity", path.name, "business name is missing from the filename or differs from the cover")
    return business_name, date_text


def relationship_targets(parts: dict[str, bytes]) -> dict[str, str]:
    rels_part = "word/_rels/document.xml.rels"
    if rels_part not in parts:
        return {}
    root = parse_xml(parts[rels_part], rels_part)
    targets = {}
    for rel in root:
        rel_id = rel.get("Id", "")
        target = rel.get("Target", "")
        if target and not target.startswith("/"):
            target = f"word/{target}".replace("word/../", "")
        targets[rel_id] = target
    return targets


def check_headers_footers(
    sections: list[etree._Element],
    parts: dict[str, bytes],
    business_name: str,
    template_mode: bool,
    report: Report,
) -> None:
    targets = relationship_targets(parts)
    settings_part = "word/settings.xml"
    if settings_part in parts:
        settings_root = parse_xml(parts[settings_part], settings_part)
        if settings_root.find("w:evenAndOddHeaders", NS) is not None:
            report.fail("Headers and footers", settings_part, "different odd and even headers are enabled")
    if not sections:
        return
    for reference in sections[0].xpath("./w:headerReference | ./w:footerReference", namespaces=NS):
        target = targets.get(reference.get(f"{R}id", ""), "")
        if target in parts and element_text(parse_xml(parts[target], target)):
            report.fail("Headers and footers", "cover section", f"cover uses non-empty {Path(target).name}")
    if len(sections) < 2:
        return
    body = sections[1]
    if body.find("w:titlePg", NS) is not None:
        report.fail("Headers and footers", "body section", "first body page suppresses the running header or footer")
    header_refs = body.xpath("./w:headerReference", namespaces=NS)
    footer_refs = body.xpath("./w:footerReference", namespaces=NS)
    for reference in header_refs + footer_refs:
        if reference.get(f"{W}type") != "default":
            report.fail("Headers and footers", "body section", "first-page or even-page header/footer reference remains")
    if not header_refs:
        report.fail("Headers and footers", "body section", "running header is missing")
    if not footer_refs:
        report.fail("Headers and footers", "body section", "running footer is missing")
    header_text = ""
    for reference in header_refs:
        target = targets.get(reference.get(f"{R}id", ""), "")
        if target in parts:
            header_text += " " + element_text(parse_xml(parts[target], target))
    if not header_text.strip():
        report.fail("Headers and footers", "body header", "header is empty")
    elif not template_mode and business_name and business_name.casefold() not in header_text.casefold():
        report.fail("Headers and footers", "body header", "business name is missing")
    footer_text = ""
    footer_fields = ""
    for reference in footer_refs:
        target = targets.get(reference.get(f"{R}id", ""), "")
        if target in parts:
            root = parse_xml(parts[target], target)
            footer_text += " " + element_text(root)
            footer_fields += " " + " ".join(root.xpath(".//w:instrText/text()", namespaces=NS))
    if "confidential" not in footer_text.casefold():
        report.fail("Headers and footers", "body footer", "confidentiality marking is missing")
    if "PAGE" not in footer_fields or not any(field in footer_fields for field in ("NUMPAGES", "SECTIONPAGES")):
        report.fail("Headers and footers", "body footer", "Page X of Y fields are missing")


def check_toc(document_root: etree._Element, report: Report) -> None:
    instructions = " ".join(document_root.xpath(".//w:instrText/text()", namespaces=NS))
    if not re.search(r"\bTOC\b", instructions):
        report.fail("TOC", "word/document.xml", "updateable TOC field is missing")
    if not re.search(r'TOC\s+\\o\s+"1-3"', instructions):
        report.fail("TOC", "word/document.xml", "TOC does not include Heading 1 through Heading 3")


def check_headings(records: list[ParagraphRecord], report: Report) -> None:
    patterns = {
        "Heading 1": re.compile(r"^(?:\d+\.\s+|Appendix [A-Z]\.)"),
        "Heading 2": re.compile(r"^\d+\.\d+\s+"),
        "Heading 3": re.compile(r"^\d+\.\d+\.\d+\s+"),
    }
    for record in records:
        if record.style_name.startswith("Heading ") and record.style_name not in patterns:
            report.fail("Heading hierarchy", f"paragraph {record.index}", f"disallowed style {record.style_name}")
        if record.style_name in patterns and record.text and not patterns[record.style_name].match(record.text):
            report.fail("Heading hierarchy", f"paragraph {record.index}", f"{record.style_name} is not correctly numbered: {record.text}")
        if re.match(r"^\d+(?:\.\d+){0,2}\.?\s+\S", record.text) and record.style_name not in patterns:
            report.fail("Heading hierarchy", f"paragraph {record.index}", f"numbered heading text uses {record.style_name}")

    substantive = [record for record in records if record.text]
    for current, following in zip(substantive, substantive[1:]):
        if current.is_heading and (following.is_heading or following.is_list):
            report.fail(
                "Heading hierarchy",
                f"paragraph {current.index}",
                f"heading is followed by {following.style_name} at paragraph {following.index}",
            )


def check_lists(records: list[ParagraphRecord], report: Report) -> None:
    substantive = [record for record in records if record.text]
    position = 0
    while position < len(substantive):
        if not substantive[position].is_list:
            position += 1
            continue
        start = position
        while position < len(substantive) and substantive[position].is_list:
            position += 1
        group = substantive[start:position]
        location = f"paragraphs {group[0].index}-{group[-1].index}"
        if len(group) < 3:
            report.fail("Lists", location, f"list contains only {len(group)} item(s)")
        if start == 0 or not substantive[start - 1].text.rstrip().endswith(":"):
            report.fail("Lists", location, "list has no preceding stem sentence ending in a colon")
        if any(item.list_level > 1 for item in group):
            report.fail("Lists", location, "list nesting exceeds one level")


def table_style_has_plain_borders(style: etree._Element | None) -> bool:
    if style is None:
        return False
    edges = style.xpath("./w:tblPr/w:tblBorders/*", namespaces=NS)
    required = {"top", "left", "bottom", "right", "insideH", "insideV"}
    found = {etree.QName(edge).localname for edge in edges}
    if found != required:
        return False
    return all(
        edge.get(f"{W}val") == "single"
        and edge.get(f"{W}sz") == "4"
        and edge.get(f"{W}color") in {None, "auto", "000000"}
        for edge in edges
    )


def table_style_has_bold_first_row(style: etree._Element | None) -> bool:
    if style is None:
        return False
    return bool(style.xpath('./w:tblStylePr[@w:type="firstRow"]//w:b', namespaces=NS))


def check_tables(
    document_root: etree._Element,
    style_names: dict[str, str],
    style_elements: dict[str, etree._Element],
    records: list[ParagraphRecord],
    report: Report,
) -> None:
    body_texts = [record.text for record in records]
    for table_number, table in enumerate(document_root.xpath(".//w:body//w:tbl", namespaces=NS), 1):
        location = f"table {table_number}"
        previous = table.getprevious()
        while previous is not None and previous.tag != f"{W}p":
            previous = previous.getprevious()
        caption = element_text(previous) if previous is not None else ""
        caption_style_id = ""
        if previous is not None:
            p_style = previous.find("w:pPr/w:pStyle", NS)
            caption_style_id = p_style.get(f"{W}val", "") if p_style is not None else ""
        expected = re.compile(rf"^Table {table_number}\.\s+\S")
        if not expected.search(caption):
            report.fail("Tables", location, f"caption is missing or not numbered as Table {table_number}")
        if style_names.get(caption_style_id, caption_style_id) != "Table title":
            report.fail("Tables", location, "caption does not use the Table title style")
        references = [
            text
            for text in body_texts
            if re.search(rf"\bTable {table_number}\b", text) and text != caption
        ]
        if not references:
            report.fail("Tables", location, "table is not referred to by number in body text")

        rows = table.findall("w:tr", NS)
        if len(rows) < 4:
            report.fail("Tables", location, "table compares fewer than three items")
        for row_index, row in enumerate(rows[1:], 2):
            if not element_text(row):
                report.fail("Tables", f"{location}, row {row_index}", "blank filler row")
        if table.xpath(".//w:gridSpan[@w:val != '1'] | .//w:vMerge", namespaces=NS):
            report.fail("Tables", location, "merged cells are present")

        style_node = table.find("w:tblPr/w:tblStyle", NS)
        style_id = style_node.get(f"{W}val", "") if style_node is not None else ""
        if style_names.get(style_id, style_id) != "Table Grid":
            report.fail("Tables", location, "table does not use Table Grid")
        style = style_elements.get(style_id)
        if not table_style_has_plain_borders(style):
            report.fail("Tables", location, "table borders are not single black 0.5 point borders")
        if not table_style_has_bold_first_row(style):
            report.fail("Tables", location, "table style does not make the first row bold")
        if not rows or rows[0].find("w:trPr/w:tblHeader", NS) is None:
            report.fail("Tables", location, "first row is not marked to repeat")

        if table.xpath(".//w:tblLook[@w:noHBand != '1' or @w:noVBand != '1']", namespaces=NS):
            report.fail("Tables", location, "table banding is enabled")

        for row_index, row in enumerate(rows[1:], 2):
            for column_index, cell in enumerate(row.findall("w:tc", NS), 1):
                value = element_text(cell).replace(",", "").replace("$", "").strip()
                if re.fullmatch(r"\(?-?\d+(?:\.\d+)?%?\)?", value):
                    for paragraph in cell.findall("w:p", NS):
                        alignment = paragraph.find("w:pPr/w:jc", NS)
                        if alignment is None or alignment.get(f"{W}val") != "right":
                            report.fail(
                                "Tables",
                                f"{location}, row {row_index}, column {column_index}",
                                "numeric cell is not right-aligned",
                            )


def check_direct_formatting(document_root: etree._Element, report: Report) -> None:
    prohibited_run = {"b", "i", "color", "highlight", "shd", "rFonts", "sz", "szCs", "u"}
    for index, run_properties in enumerate(document_root.xpath(".//w:body//w:rPr", namespaces=NS), 1):
        children = {etree.QName(child).localname for child in run_properties}
        if children & prohibited_run:
            parent_run = run_properties.getparent()
            text = element_text(parent_run)
            report.fail(
                "Named-style discipline",
                f"direct run formatting {index}",
                f"direct formatting {sorted(children & prohibited_run)} on {text[:60]!r}",
            )


def check_language_and_placeholders(
    path: Path,
    records: list[ParagraphRecord],
    table_roots: list[etree._Element],
    template_mode: bool,
    report: Report,
) -> None:
    locations: list[tuple[str, str]] = [(f"paragraph {record.index}", record.text) for record in records if record.text]
    for table_index, table in enumerate(table_roots, 1):
        for row_index, row in enumerate(table.findall("w:tr", NS), 1):
            for cell_index, cell in enumerate(row.findall("w:tc", NS), 1):
                text = element_text(cell)
                if text:
                    locations.append((f"table {table_index}, row {row_index}, cell {cell_index}", text))
    for location, text in locations:
        if "—" in text:
            report.fail("Language and placeholders", location, "em dash character")
        if not template_mode:
            for label, pattern in PLACEHOLDER_PATTERNS.items():
                if re.search(pattern, text, flags=re.IGNORECASE):
                    report.fail("Language and placeholders", location, label)
            for label, pattern in BANNED_PATTERNS.items():
                if re.search(pattern, text, flags=re.IGNORECASE):
                    report.fail("Language and placeholders", location, f"banned expression: {label}")

    if template_mode:
        return
    template_path = Path(__file__).resolve().parent.parent / "assets" / "business-plan-template.docx"
    if template_path.is_file() and template_path.resolve() != path.resolve():
        try:
            with ZipFile(template_path) as archive:
                root = parse_xml(archive.read("word/document.xml"), "template word/document.xml")
                template_styles = parse_xml(archive.read("word/styles.xml"), "template word/styles.xml")
            template_style_names, _ = style_maps(template_styles)
            guidance = {
                record.text
                for record in paragraph_records(root, template_style_names)
                if record.style_name == "Body Text" and len(record.text) >= 40
            }
            for location, text in locations:
                if text in guidance:
                    report.fail("Language and placeholders", location, "unchanged template guidance remains")
        except (BadZipFile, KeyError, ValueError):
            report.fail("Language and placeholders", str(template_path), "could not compare final text with template guidance")


def check_styles_used(
    records: list[ParagraphRecord],
    document_root: etree._Element,
    parts: dict[str, bytes],
    style_names: dict[str, str],
    report: Report,
) -> None:
    used = {record.style_name for record in records if record.text}
    for table in document_root.xpath(".//w:body//w:tbl", namespaces=NS):
        style = table.find("w:tblPr/w:tblStyle", NS)
        if style is not None:
            style_id = style.get(f"{W}val", "")
            used.add(style_names.get(style_id, style_id))
    for style_id in document_root.xpath(".//w:body//w:rStyle/@w:val", namespaces=NS):
        used.add(style_names.get(style_id, style_id))
    for part in (name for name in parts if re.fullmatch(r"word/(header|footer)\d+\.xml", name)):
        root = parse_xml(parts[part], part)
        for style_id in root.xpath(".//w:pStyle/@w:val | .//w:rStyle/@w:val", namespaces=NS):
            used.add(style_names.get(style_id, style_id))
    unapproved = sorted(style for style in used if style and style not in APPROVED_STYLES)
    for style in unapproved:
        report.fail("Named-style discipline", "document styles", f"unapproved style used: {style}")
    approved_used = sorted(used & APPROVED_STYLES)
    approved_unused = sorted(APPROVED_STYLES - used)
    report.notes.append(f"Approved template styles used: {', '.join(approved_used) if approved_used else 'none'}")
    report.notes.append(f"Approved template styles unused: {', '.join(approved_unused) if approved_unused else 'none'}")


def validate(path: Path, template_mode: bool) -> int:
    report = Report()
    checks = [
        "Black-and-white formatting",
        "Typeface and paragraph styling",
        "Page architecture",
        "Cover and file identity",
        "Headers and footers",
        "TOC",
        "Heading hierarchy",
        "Lists",
        "Tables",
        "Named-style discipline",
        "Language and placeholders",
    ]
    if not path.is_file():
        print(f"FAIL: File not found: {path}")
        return 2
    try:
        with ZipFile(path) as archive:
            parts = {name: archive.read(name) for name in archive.namelist()}
    except BadZipFile:
        print(f"FAIL: Not a valid DOCX package: {path}")
        return 2
    for required in ("word/document.xml", "word/styles.xml"):
        if required not in parts:
            print(f"FAIL: Missing required DOCX part: {required}")
            return 2

    document_root = parse_xml(parts["word/document.xml"], "word/document.xml")
    styles_root = parse_xml(parts["word/styles.xml"], "word/styles.xml")
    style_names, style_elements = style_maps(styles_root)
    records = paragraph_records(document_root, style_names)
    check_colour_and_graphics(parts, report)
    check_fonts(styles_root, document_root, parts, report)
    sections = check_page_setup(document_root, report)
    business_name, _ = check_cover_and_filename(path, records, template_mode, report)
    check_headers_footers(sections, parts, business_name, template_mode, report)
    check_toc(document_root, report)
    check_headings(records, report)
    check_lists(records, report)
    check_tables(document_root, style_names, style_elements, records, report)
    check_direct_formatting(document_root, report)
    check_styles_used(records, document_root, parts, style_names, report)
    check_language_and_placeholders(
        path,
        records,
        document_root.xpath(".//w:body//w:tbl", namespaces=NS),
        template_mode,
        report,
    )
    report.print(checks)
    return 1 if report.failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path, help="DOCX file to validate")
    parser.add_argument(
        "--template",
        action="store_true",
        help="Allow identity placeholders and drafting guidance in the bundled template",
    )
    args = parser.parse_args()
    sys.exit(validate(args.document, args.template))


if __name__ == "__main__":
    main()
