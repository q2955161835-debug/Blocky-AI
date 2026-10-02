#!/usr/bin/env python3
"""Shared engine for the bundled financial-forecast template.

The bundled template contains legacy shared formulas and 22 form-control
dropdowns. Generic spreadsheet libraries corrupt it: openpyxl silently drops
33 shared-formula followers and every form control on save, and a LibreOffice
round-trip strips the form controls. This library therefore never rewrites the
delivered workbook with a spreadsheet application. It edits cell XML
surgically inside the zip package, recalculates a disposable shadow copy in
headless LibreOffice through the UNO bridge, and grafts the freshly computed
cached values back into the untouched original package.

Pipeline: inject inputs -> UNO hard recalc to shadow -> graft cached values
-> verify formula inventory against the pristine template.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = "{%s}" % MAIN_NS

FORMULA_ERRORS = {
    "#CALC!", "#DIV/0!", "#FIELD!", "#NAME?", "#N/A", "#NULL!",
    "#NUM!", "#REF!", "#SPILL!", "#VALUE!",
}

CELL_REF = re.compile(r"^([A-Z]{1,3})([0-9]+)$")


class WorkbookEngineError(RuntimeError):
    pass


# ---------------------------------------------------------------- package IO

def load_parts(path: Path) -> tuple[dict[str, bytes], list[zipfile.ZipInfo]]:
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        parts = {info.filename: archive.read(info.filename) for info in infos}
    return parts, infos


def save_parts(path: Path, parts: dict[str, bytes], infos: list[zipfile.ZipInfo]) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as archive:
        written = set()
        for info in infos:
            archive.writestr(info, parts[info.filename])
            written.add(info.filename)
        for name, data in parts.items():
            if name not in written:
                archive.writestr(name, data)
    tmp.replace(path)


def sheet_part_map(source: Path | dict[str, bytes]) -> dict[str, str]:
    """Map sheet name -> part path (e.g. 'Financial Plan' -> 'xl/worksheets/sheet2.xml')."""
    if isinstance(source, dict):
        wb_xml, rels_xml = source["xl/workbook.xml"], source["xl/_rels/workbook.xml.rels"]
    else:
        with zipfile.ZipFile(source) as archive:
            wb_xml = archive.read("xl/workbook.xml")
            rels_xml = archive.read("xl/_rels/workbook.xml.rels")
    workbook = ET.fromstring(wb_xml)
    rels = ET.fromstring(rels_xml)
    targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("{%s}Relationship" % PKG_REL_NS)
    }
    result = {}
    for sheet in workbook.findall(".//" + NS + "sheet"):
        target = targets[sheet.attrib["{%s}id" % REL_NS]].lstrip("/")
        result[sheet.attrib["name"]] = target if target.startswith("xl/") else "xl/" + target
    return result


# ------------------------------------------------------------- cell helpers

def split_cell(ref: str) -> tuple[str, int]:
    match = CELL_REF.match(ref)
    if not match:
        raise WorkbookEngineError(f"Bad cell reference: {ref}")
    return match.group(1), int(match.group(2))


def col_number(letters: str) -> int:
    number = 0
    for char in letters:
        number = number * 26 + (ord(char) - 64)
    return number


def split_sheet_ref(reference: str) -> tuple[str, str]:
    if "!" not in reference:
        raise WorkbookEngineError(f"Reference must include a sheet name: {reference}")
    sheet, cell = reference.rsplit("!", 1)
    return sheet.strip("'"), cell.replace("$", "").upper()


def excel_serial(value: date | datetime) -> int:
    if isinstance(value, datetime):
        value = value.date()
    return (value - date(1899, 12, 30)).days


# ------------------------------------------------------- formula inventory

def formula_inventory(path: Path) -> dict[str, str]:
    """Every formula cell with shared formulas expanded to their per-cell text.

    Keys are 'Sheet!REF'; values are the formula text without the '=' prefix.
    Expansion uses openpyxl's Translator, the same relative-reference logic a
    spreadsheet applies when filling a shared formula across its range.
    """
    from openpyxl.formula.translate import Translator

    inventory: dict[str, str] = {}
    smap = sheet_part_map(path)
    with zipfile.ZipFile(path) as archive:
        for sheet_name, part in smap.items():
            root = ET.fromstring(archive.read(part))
            masters: dict[str, tuple[str, str]] = {}
            for cell in root.iter(NS + "c"):
                formula = cell.find(NS + "f")
                if formula is None:
                    continue
                if formula.attrib.get("t") == "shared" and (formula.text or "").strip():
                    masters[formula.attrib["si"]] = (cell.attrib["r"], formula.text)
            for cell in root.iter(NS + "c"):
                formula = cell.find(NS + "f")
                if formula is None:
                    continue
                text = (formula.text or "").strip()
                if not text and formula.attrib.get("t") == "shared":
                    si = formula.attrib.get("si")
                    if si not in masters:
                        raise WorkbookEngineError(
                            f"Shared formula follower without master: {sheet_name}!{cell.attrib['r']}"
                        )
                    origin, master_text = masters[si]
                    text = Translator("=" + master_text, origin=origin).translate_formula(
                        cell.attrib["r"]
                    )[1:]
                inventory[f"{sheet_name}!{cell.attrib['r']}"] = text
    return inventory


def parts_summary(path: Path) -> dict[str, int]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    return {
        "ctrl_props": sum(1 for n in names if n.startswith("xl/ctrlProps/")),
        "vml_drawings": sum(1 for n in names if "vmlDrawing" in n),
        "drawings": sum(1 for n in names if re.match(r"xl/drawings/drawing\d+\.xml$", n)),
        "media": sum(1 for n in names if n.startswith("xl/media/")),
        "defined_names": len(workbook.findall(".//" + NS + "definedName")),
        "sheets": len(workbook.findall(".//" + NS + "sheet")),
    }


def cached_error_cells(path: Path) -> list[str]:
    errors = []
    smap = sheet_part_map(path)
    with zipfile.ZipFile(path) as archive:
        for sheet_name, part in smap.items():
            root = ET.fromstring(archive.read(part))
            for cell in root.iter(NS + "c"):
                value = cell.find(NS + "v")
                if value is not None and (value.text or "").strip().upper() in FORMULA_ERRORS:
                    errors.append(f"{sheet_name}!{cell.attrib['r']}: {value.text}")
    return errors


# ------------------------------------------------------------ shared strings

class SharedStrings:
    def __init__(self, xml: str):
        self.xml = xml
        self._new: dict[str, int] = {}
        match = re.search(r'<sst[^>]*?uniqueCount="(\d+)"', xml)
        self.unique = int(match.group(1)) if match else len(re.findall(r"<si>", xml))
        match = re.search(r'<sst[^>]*?\bcount="(\d+)"', xml)
        self.count = int(match.group(1)) if match else self.unique
        self._added_refs = 0
        # plain existing strings, reusable by exact text
        self._existing: dict[str, int] = {}
        for index, si in enumerate(re.findall(r"<si>(.*?)</si>", xml, re.S)):
            plain = re.fullmatch(r'<t(?: xml:space="preserve")?>(.*)</t>', si, re.S)
            if plain:
                from xml.sax.saxutils import unescape
                self._existing[unescape(plain.group(1))] = index

    def index_for(self, text: str) -> int:
        self._added_refs += 1
        if text in self._existing:
            return self._existing[text]
        if text in self._new:
            return self._new[text]
        index = self.unique
        self._new[text] = index
        self.unique += 1
        self.xml = self.xml.replace(
            "</sst>",
            '<si><t xml:space="preserve">%s</t></si></sst>' % escape(text),
        )
        return index

    def serialize(self) -> str:
        xml = self.xml
        xml = re.sub(
            r'(<sst[^>]*?\bcount=")\d+(")',
            lambda m: m.group(1) + str(self.count + self._added_refs) + m.group(2),
            xml, count=1,
        )
        xml = re.sub(
            r'(uniqueCount=")\d+(")',
            lambda m: m.group(1) + str(self.unique) + m.group(2),
            xml, count=1,
        )
        return xml


# ---------------------------------------------------------------- injection

def _render_cell(ref: str, attrs: str, value, shared_strings: SharedStrings) -> str:
    attrs = re.sub(r'\s+t="[^"]*"', "", attrs)
    if isinstance(value, bool):
        return '<c r="%s"%s t="b"><v>%d</v></c>' % (ref, attrs, 1 if value else 0)
    if isinstance(value, (int, float)):
        return '<c r="%s"%s><v>%s</v></c>' % (ref, attrs, repr(value) if isinstance(value, float) else value)
    if isinstance(value, (date, datetime)):
        return '<c r="%s"%s><v>%d</v></c>' % (ref, attrs, excel_serial(value))
    if value is None:
        return '<c r="%s"%s/>' % (ref, attrs)
    index = shared_strings.index_for(str(value))
    return '<c r="%s"%s t="s"><v>%d</v></c>' % (ref, attrs, index)


def inject_cells(path: Path, assignments: dict[str, object]) -> dict[str, list[str]]:
    """Write values into cells, addressed as 'Sheet!REF', preserving all other bytes.

    Refuses to overwrite any cell that currently contains a formula. Returns a
    report of written and refused cells. Also sets fullCalcOnLoad so every
    spreadsheet application recalculates the workbook when it is opened.
    """
    parts, infos = load_parts(path)
    smap = sheet_part_map(parts)
    shared = SharedStrings(parts["xl/sharedStrings.xml"].decode("utf-8"))

    by_sheet: dict[str, dict[str, object]] = {}
    for reference, value in assignments.items():
        sheet, cell = split_sheet_ref(reference)
        if sheet not in smap:
            raise WorkbookEngineError(f"Unknown sheet in reference: {reference}")
        by_sheet.setdefault(sheet, {})[cell] = value

    written: list[str] = []
    refused: list[str] = []

    for sheet, cells in by_sheet.items():
        xml = parts[smap[sheet]].decode("utf-8")
        for ref in sorted(cells, key=lambda r: (split_cell(r)[1], col_number(split_cell(r)[0]))):
            value = cells[ref]
            column, row = split_cell(ref)
            pattern_self = re.compile(r'<c r="%s"([^>]*?)/>' % ref)
            pattern_full = re.compile(r'<c r="%s"([^>]*?)>(.*?)</c>' % ref, re.S)
            match = pattern_self.search(xml)
            if match:
                xml = xml[: match.start()] + _render_cell(ref, match.group(1), value, shared) + xml[match.end():]
                written.append(f"{sheet}!{ref}")
                continue
            match = pattern_full.search(xml)
            if match:
                if "<f" in match.group(2):
                    refused.append(f"{sheet}!{ref}: cell contains a formula")
                    continue
                xml = xml[: match.start()] + _render_cell(ref, match.group(1), value, shared) + xml[match.end():]
                written.append(f"{sheet}!{ref}")
                continue
            # cell absent: insert into its row, creating the row if needed
            new_cell = _render_cell(ref, "", value, shared)
            row_match = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row, xml, re.S)
            if row_match:
                body = row_match.group(1)
                inserted = False
                for existing in re.finditer(r'<c r="([A-Z]+)(\d+)"', body):
                    if col_number(existing.group(1)) > col_number(column):
                        offset = row_match.start(1) + existing.start()
                        xml = xml[:offset] + new_cell + xml[offset:]
                        inserted = True
                        break
                if not inserted:
                    xml = xml[: row_match.end(1)] + new_cell + xml[row_match.end(1):]
            else:
                new_row = '<row r="%d">%s</row>' % (row, new_cell)
                placed = False
                for other in re.finditer(r'<row r="(\d+)"', xml):
                    if int(other.group(1)) > row:
                        xml = xml[: other.start()] + new_row + xml[other.start():]
                        placed = True
                        break
                if not placed:
                    xml = xml.replace("</sheetData>", new_row + "</sheetData>")
            written.append(f"{sheet}!{ref}")
        parts[smap[sheet]] = xml.encode("utf-8")

    parts["xl/sharedStrings.xml"] = shared.serialize().encode("utf-8")
    parts["xl/workbook.xml"] = _ensure_full_calc(parts["xl/workbook.xml"])
    save_parts(path, parts, infos)
    return {"written": written, "refused": refused}


def _ensure_full_calc(workbook_xml: bytes) -> bytes:
    xml = workbook_xml.decode("utf-8")
    if "fullCalcOnLoad" in xml:
        return workbook_xml
    if "<calcPr" in xml:
        xml = xml.replace("<calcPr", '<calcPr fullCalcOnLoad="1"', 1)
    else:
        xml = xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')
    return xml.encode("utf-8")


# ------------------------------------------------------------------- recalc

def uno_recalculate(source: Path, destination: Path, timeout: int = 240) -> None:
    """Hard-recalculate a copy of the workbook in headless LibreOffice.

    Loads the source, runs calculateAll twice, and stores to the destination.
    The source file itself is never modified. Uses a throwaway LibreOffice
    profile and a unique pipe so concurrent runs cannot collide.
    """
    import uno  # python3-uno, ships with LibreOffice
    from com.sun.star.beans import PropertyValue

    source = source.resolve()
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex[:12]
    profile = Path(tempfile.gettempdir()) / f"lo-profile-{token}"
    pipe = f"wbengine{token}"

    process = subprocess.Popen(
        [
            "soffice", "--headless", "--invisible", "--norestore", "--nologo",
            "--nolockcheck", "--nodefault",
            f"-env:UserInstallation=file://{profile}",
            f"--accept=pipe,name={pipe};urp;",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    def prop(name: str, value) -> PropertyValue:
        entry = PropertyValue()
        entry.Name = name
        entry.Value = value
        return entry

    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local
        )
        context = None
        deadline = time.time() + min(timeout, 90)
        while time.time() < deadline:
            try:
                context = resolver.resolve(
                    f"uno:pipe,name={pipe};urp;StarOffice.ComponentContext"
                )
                break
            except Exception:
                if process.poll() is not None:
                    raise WorkbookEngineError("LibreOffice exited before accepting connections")
                time.sleep(0.5)
        if context is None:
            raise WorkbookEngineError("Could not connect to LibreOffice for recalculation")

        desktop = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        document = desktop.loadComponentFromURL(
            f"file://{source}", "_blank", 0,
            (prop("Hidden", True), prop("ReadOnly", False)),
        )
        try:
            document.calculateAll()
            document.calculateAll()
            document.storeToURL(
                f"file://{destination}",
                (prop("FilterName", "Calc MS Excel 2007 XML"), prop("Overwrite", True)),
            )
        finally:
            document.close(False)
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except Exception:
            process.kill()
        shutil.rmtree(profile, ignore_errors=True)

    if not destination.is_file():
        raise WorkbookEngineError("Recalculated shadow copy was not produced")


# -------------------------------------------------------------------- graft

_CELL_BLOCK = re.compile(r'(<c r="([A-Z]+[0-9]+)"[^>]*?)(/>|>(.*?)</c>)', re.S)
_FORMULA_BLOCK = re.compile(r"<f.*?(?:/>|</f>)", re.S)


def graft_cached_values(target: Path, shadow: Path) -> dict[str, int]:
    """Copy every recalculated formula result from the shadow into the target.

    Only the cached <v> of formula cells changes; formula definitions, styles,
    controls, and every other part of the target remain untouched.
    """
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        import openpyxl
        shadow_values = openpyxl.load_workbook(shadow, data_only=True)

    parts, infos = load_parts(target)
    smap = sheet_part_map(parts)
    counts: dict[str, int] = {}

    for sheet_name, part in smap.items():
        if sheet_name not in shadow_values.sheetnames:
            continue
        values = shadow_values[sheet_name]
        xml = parts[part].decode("utf-8")
        grafted = 0

        def replace(match: re.Match) -> str:
            nonlocal grafted
            head, ref, tail = match.group(1), match.group(2), match.group(3)
            body = match.group(4) if tail.startswith(">") else None
            if not body or "<f" not in body:
                return match.group(0)
            formula_xml = _FORMULA_BLOCK.search(body).group(0)
            value = values[ref].value
            head = re.sub(r'\s+t="[^"]*"', "", head)
            grafted += 1
            if value is None:
                return head + ">" + formula_xml + "</c>"
            if isinstance(value, bool):
                return head + ' t="b">' + formula_xml + "<v>%d</v></c>" % (1 if value else 0)
            if isinstance(value, (int, float)):
                return head + ">" + formula_xml + "<v>%s</v></c>" % (repr(value) if isinstance(value, float) else value)
            if isinstance(value, (datetime, date)):
                return head + ">" + formula_xml + "<v>%d</v></c>" % excel_serial(value)
            text = str(value)
            kind = "e" if text.upper() in FORMULA_ERRORS else "str"
            return head + ' t="%s">' % kind + formula_xml + "<v>%s</v></c>" % escape(text)

        xml = _CELL_BLOCK.sub(replace, xml)
        parts[part] = xml.encode("utf-8")
        counts[sheet_name] = grafted

    save_parts(target, parts, infos)
    return counts


# --------------------------------------------------------------- new sheets

def add_values_sheet(path: Path, sheet_name: str, rows: list[list[object]]) -> None:
    """Append a plain values-only worksheet (for a source log) to the package."""
    parts, infos = load_parts(path)
    if sheet_name in sheet_part_map(parts):
        raise WorkbookEngineError(f"Sheet already exists: {sheet_name}")

    existing = [n for n in parts if re.match(r"xl/worksheets/sheet\d+\.xml$", n)]
    number = max(int(re.search(r"(\d+)", Path(n).stem).group(1)) for n in existing) + 1
    part_name = f"xl/worksheets/sheet{number}.xml"

    shared = SharedStrings(parts["xl/sharedStrings.xml"].decode("utf-8"))
    body = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for col_index, value in enumerate(row, start=1):
            if value is None or value == "":
                continue
            letters = ""
            n = col_index
            while n:
                n, rem = divmod(n - 1, 26)
                letters = chr(65 + rem) + letters
            cells.append(_render_cell(f"{letters}{row_index}", "", value, shared))
        body.append('<row r="%d">%s</row>' % (row_index, "".join(cells)))
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="%s"><sheetData>%s</sheetData>'
        "</worksheet>" % (MAIN_NS, "".join(body))
    )

    rels_xml = parts["xl/_rels/workbook.xml.rels"].decode("utf-8")
    rel_ids = [int(m.group(1)) for m in re.finditer(r'Id="rId(\d+)"', rels_xml)]
    rel_id = f"rId{max(rel_ids) + 1}"
    rels_xml = rels_xml.replace(
        "</Relationships>",
        '<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/></Relationships>'
        % (rel_id, number),
    )

    workbook_xml = parts["xl/workbook.xml"].decode("utf-8")
    sheet_ids = [int(m.group(1)) for m in re.finditer(r'sheetId="(\d+)"', workbook_xml)]
    workbook_xml = workbook_xml.replace(
        "</sheets>",
        '<sheet name="%s" sheetId="%d" r:id="%s"/></sheets>'
        % (escape(sheet_name), max(sheet_ids) + 1, rel_id),
    )

    content_types = parts["[Content_Types].xml"].decode("utf-8")
    content_types = content_types.replace(
        "</Types>",
        '<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
        % number,
    )

    parts[part_name] = sheet_xml.encode("utf-8")
    parts["xl/_rels/workbook.xml.rels"] = rels_xml.encode("utf-8")
    parts["xl/workbook.xml"] = workbook_xml.encode("utf-8")
    parts["[Content_Types].xml"] = content_types.encode("utf-8")
    parts["xl/sharedStrings.xml"] = shared.serialize().encode("utf-8")
    save_parts(path, parts, infos)


# ------------------------------------------------------------------ pristine

def pristine_template() -> Path:
    candidate = Path(__file__).resolve().parent.parent / "assets" / "financial-forecast-template.xlsx"
    if not candidate.is_file():
        raise WorkbookEngineError(f"Bundled template not found: {candidate}")
    return candidate
