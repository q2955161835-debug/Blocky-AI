"""Normalize a Word-rendered DOCX copy to the business-plan style contract."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W_NS, "r": R_NS}
FONT = "Arial"
TOC_STYLES = {"toc 1", "toc 2", "toc 3"}
DIRECT_RUN_STYLE = {"b", "i", "color", "highlight", "shd", "rFonts", "sz", "szCs", "u"}


def qn(local: str) -> str:
    return f"{{{W_NS}}}{local}"


def xml_bytes(root: etree._Element) -> bytes:
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def normalize_word_part(part: str, data: bytes, style_names: dict[str, str]) -> bytes:
    root = etree.fromstring(data)
    for element in list(root.iter()):
        for attribute in list(element.attrib):
            if etree.QName(attribute).localname.endswith("Theme"):
                del element.attrib[attribute]
        if element.tag == qn("rFonts"):
            for key in ("ascii", "hAnsi", "eastAsia", "cs"):
                element.set(qn(key), FONT)
        elif element.tag == qn("color"):
            value = element.get(qn("val"))
            if value and value.casefold() not in {"auto", "000000", "00000000"}:
                element.set(qn("val"), "000000")
        elif element.tag in {qn("shd"), qn("highlight"), qn("drawing"), qn("pict"), qn("object")}:
            parent = element.getparent()
            if parent is not None:
                parent.remove(element)
        elif etree.QName(element).localname in {"top", "left", "bottom", "right", "insideH", "insideV"}:
            if element.tag.startswith(f"{{{W_NS}}}") and element.get(qn("color")):
                color = element.get(qn("color"))
                if color.casefold() not in {"auto", "000000", "00000000"}:
                    element.set(qn("color"), "000000")

    if part == "word/document.xml":
        for run_properties in root.xpath(".//w:body//w:rPr", namespaces=NS):
            for child in list(run_properties):
                if etree.QName(child).localname in DIRECT_RUN_STYLE:
                    run_properties.remove(child)
            if len(run_properties) == 0:
                parent = run_properties.getparent()
                if parent is not None:
                    parent.remove(run_properties)

        for paragraph in root.xpath(".//w:body//w:p", namespaces=NS):
            style_id = paragraph.xpath("string(w:pPr/w:pStyle/@w:val)", namespaces=NS)
            if style_names.get(style_id, "").casefold() in TOC_STYLES:
                text_nodes = paragraph.xpath(".//w:t", namespaces=NS)
                first = next((node for node in text_nodes if node.text), None)
                if first is not None and not first.text.startswith("\ufeff"):
                    first.text = "\ufeff" + first.text
        for table in root.xpath(".//w:body//w:tbl", namespaces=NS):
            properties = table.find(qn("tblPr"))
            if properties is None:
                properties = etree.Element(qn("tblPr"))
                table.insert(0, properties)
            grid = table.find(qn("tblGrid"))
            grid_widths = [int(column.get(qn("w"), "0")) for column in grid.findall(qn("gridCol"))] if grid is not None else []
            if grid_widths:
                first_start = table.find("w:tr/w:tc/w:tcPr/w:tcMar/w:start", NS)
                indent_value = first_start.get(qn("w"), "85") if first_start is not None else "85"
                indent = properties.find(qn("tblInd"))
                if indent is None:
                    indent = etree.Element(qn("tblInd"))
                    table_width = properties.find(qn("tblW"))
                    properties.insert(properties.index(table_width) + 1 if table_width is not None else 1, indent)
                indent.set(qn("w"), indent_value)
                indent.set(qn("type"), "dxa")
                for row in table.findall(qn("tr")):
                    cells = row.findall(qn("tc"))
                    if len(cells) != len(grid_widths):
                        raise ValueError("Cannot normalize a table with merged or mismatched cells")
                    for cell, width in zip(cells, grid_widths):
                        cell_properties = cell.find(qn("tcPr"))
                        if cell_properties is None:
                            cell_properties = etree.Element(qn("tcPr"))
                            cell.insert(0, cell_properties)
                        cell_width = cell_properties.find(qn("tcW"))
                        if cell_width is None:
                            cell_width = etree.SubElement(cell_properties, qn("tcW"))
                        cell_width.set(qn("w"), str(width))
                        cell_width.set(qn("type"), "dxa")
            look = properties.find(qn("tblLook"))
            if look is None:
                look = etree.SubElement(properties, qn("tblLook"))
            for key, value in (("firstRow", "1"), ("lastRow", "0"), ("firstColumn", "0"),
                               ("lastColumn", "0"), ("noHBand", "1"), ("noVBand", "1")):
                look.set(qn(key), value)

    if part == "word/styles.xml":
        styles = root.xpath(".//w:style", namespaces=NS)
        for style in styles:
            name = style.find("w:name", NS)
            if name is not None and name.get(qn("val")) == "Body Text":
                ppr = style.find(qn("pPr"))
                if ppr is None:
                    ppr = etree.Element(qn("pPr"))
                    rpr_existing = style.find(qn("rPr"))
                    style.insert(style.index(rpr_existing) if rpr_existing is not None else len(style), ppr)
                spacing = ppr.find(qn("spacing"))
                if spacing is None:
                    spacing = etree.SubElement(ppr, qn("spacing"))
                for key, value in (("before", "0"), ("after", "120"), ("line", "276"), ("lineRule", "auto")):
                    spacing.set(qn(key), value)
                rpr = style.find(qn("rPr"))
                if rpr is None:
                    rpr = etree.SubElement(style, qn("rPr"))
                size = rpr.find(qn("sz"))
                if size is None:
                    size = etree.SubElement(rpr, qn("sz"))
                size.set(qn("val"), "22")
                size_cs = rpr.find(qn("szCs"))
                if size_cs is None:
                    size_cs = etree.SubElement(rpr, qn("szCs"))
                size_cs.set(qn("val"), "22")
            if name is not None and name.get(qn("val")) == "Table Grid":
                first_row = next((node for node in style.findall(qn("tblStylePr"))
                                  if node.get(qn("type")) == "firstRow"), None)
                if first_row is None:
                    first_row = etree.SubElement(style, qn("tblStylePr"), {qn("type"): "firstRow"})
                rpr = first_row.find(qn("rPr"))
                if rpr is None:
                    rpr = etree.SubElement(first_row, qn("rPr"))
                if rpr.find(qn("b")) is None:
                    etree.SubElement(rpr, qn("b"))

    return xml_bytes(root)


def remove_orphan_images(parts: dict[str, bytes]) -> set[str]:
    used_targets: set[str] = set()
    unused_image_rels: dict[str, set[str]] = {}
    for rels_name, raw in list(parts.items()):
        if not rels_name.endswith(".rels") or not rels_name.startswith("word/"):
            continue
        root = etree.fromstring(raw)
        source_name = rels_name.replace("word/_rels/", "word/").removesuffix(".rels")
        source_data = parts.get(source_name)
        source_refs: set[str] = set()
        if source_data:
            source_root = etree.fromstring(source_data)
            source_refs = set(source_root.xpath(".//@r:embed | .//@r:id | .//@r:link", namespaces=NS))
        changed = False
        for relation in list(root):
            target = relation.get("Target", "")
            if target and not target.startswith("/"):
                resolved = str(Path("word", source_name.removeprefix("word/")).parent.joinpath(target)).replace("\\", "/")
                parts_path = []
                for segment in resolved.split("/"):
                    if segment == "..":
                        if parts_path:
                            parts_path.pop()
                    elif segment != ".":
                        parts_path.append(segment)
                target = "/".join(parts_path)
            if relation.get("Type", "").endswith("/image") and relation.get("Id") not in source_refs:
                unused_image_rels.setdefault(rels_name, set()).add(target)
                root.remove(relation)
                changed = True
            elif target:
                used_targets.add(target)
        if changed:
            parts[rels_name] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    removed = set()
    for name in list(parts):
        if name.startswith("word/media/") and name not in used_targets:
            removed.add(name)
            del parts[name]
    if removed and "[Content_Types].xml" in parts:
        types = etree.fromstring(parts["[Content_Types].xml"])
        for override in list(types):
            if override.tag == f"{{{CT_NS}}}Override" and override.get("PartName", "").lstrip("/") in removed:
                types.remove(override)
        parts["[Content_Types].xml"] = etree.tostring(types, xml_declaration=True, encoding="UTF-8", standalone=True)
    return removed


def normalize_package(source: Path, output: Path) -> dict[str, object]:
    with ZipFile(source, "r") as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
        style_names: dict[str, str] = {}
        if "word/styles.xml" in parts:
            styles_root = etree.fromstring(parts["word/styles.xml"])
            for style in styles_root.xpath(".//w:style", namespaces=NS):
                name = style.find("w:name", NS)
                if name is not None:
                    style_names[style.get(qn("styleId"), "")] = name.get(qn("val"), "")
        for name in list(parts):
            if name.startswith("word/theme/"):
                del parts[name]
            elif name.startswith("word/") and name.endswith(".xml"):
                parts[name] = normalize_word_part(name, parts[name], style_names)

        for rels_name in [name for name in parts if name.startswith("word/") and name.endswith(".rels")]:
            rels = etree.fromstring(parts[rels_name])
            changed = False
            for relation in list(rels):
                if relation.get("Type", "").endswith("/theme"):
                    rels.remove(relation)
                    changed = True
            if changed:
                parts[rels_name] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)

        if "[Content_Types].xml" in parts:
            types = etree.fromstring(parts["[Content_Types].xml"])
            for override in list(types):
                if override.tag == f"{{{CT_NS}}}Override" and override.get("PartName", "").startswith("/word/theme/"):
                    types.remove(override)
            parts["[Content_Types].xml"] = etree.tostring(types, xml_declaration=True, encoding="UTF-8", standalone=True)

        removed_images = remove_orphan_images(parts)
        output.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix="normalized-docx-", suffix=".docx", dir=output.parent)
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            with ZipFile(temp_path, "w", compression=ZIP_DEFLATED) as destination:
                for item in archive.infolist():
                    if item.filename in parts:
                        destination.writestr(item, parts[item.filename])
                for name, payload in parts.items():
                    if name not in archive.namelist():
                        destination.writestr(name, payload)
            os.replace(temp_path, output)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    return {
        "status": "ok",
        "input": str(source),
        "output": str(output),
        "removed_theme_parts": True,
        "removed_unused_media": sorted(removed_images),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Word-rendered DOCX copy")
    parser.add_argument("--output", required=True, type=Path, help="Normalized DOCX destination")
    parser.add_argument("--overwrite", action="store_true", help="Replace only the named output")
    args = parser.parse_args()
    source = args.input.expanduser().resolve(strict=True)
    output = args.output.expanduser().resolve()
    if source == output:
        parser.error("Input and output must be different paths")
    if output.exists() and not args.overwrite:
        parser.error("Output exists; use --overwrite to replace only that file")
    if not any(parent.name.casefold() == "try" for parent in (output, *output.parents)):
        parser.error("Output must be below a directory named try")
    print(json.dumps(normalize_package(source, output), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
