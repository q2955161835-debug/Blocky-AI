#!/usr/bin/env python3
"""Populate a copy of the bundled financial-forecast template safely.

This is the only supported way to write values into the bundled template.
It protects every formula: values are injected surgically into the package
(form controls, styles, shared formulas, and named ranges are untouched),
a disposable shadow copy is hard-recalculated in headless LibreOffice, the
fresh results are grafted back as cached values, and the finished file is
verified cell-by-cell against the pristine template. The script exits
non-zero if a single formula changed, disappeared, or evaluates to an error.

Usage:
    python3 populate_financial_workbook.py <workbook.xlsx> --payload payload.json

Payload schema (all keys optional, at least one required):
{
  "business": {
    "status": "startup" | "existing",
    "legal_name": "...", "trading_name": "...",
    "address": "line 1\nline 2" (or a list of lines),
    "phone": "...", "fax": "...", "email": "...",
    "form_of_company": "corporation" | "partnership" | "proprietorship",
    "industry_sector": "Retail Trade" (matched against the template's list) ,
    "naics": "541611",
    "start_month": 1-12, "start_year": 2026,
    "fiscal_year_end_month": 1-12, "fiscal_year_end_year": 2027,
    "export_percent": 0.15
  },
  "cells":  { "Financial Plan!B28": "Consulting revenue",
              "Financial Plan!D28": 120000, "2!C36": 1 },
  "dates":  { "Financial Plan!D16": "2020-04-01" },
  "source_log": [ ["ID","Cell","Value","Basis","Source","URL","Accessed","Notes"],
                  ["A-01","Financial Plan!D28",120000,"assumption","...","...","2026-08-28",""] ]
}

"cells" values may be numbers or strings. "dates" values are ISO dates written
as Excel date serials. "source_log" appends a values-only "Source Log" sheet.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import warnings
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _workbook_lib import (  # noqa: E402
    WorkbookEngineError,
    cached_error_cells,
    add_values_sheet,
    formula_inventory,
    graft_cached_values,
    inject_cells,
    parts_summary,
    pristine_template,
    uno_recalculate,
)

FORM_OF_COMPANY = {"corporation": 1, "partnership": 2, "proprietorship": 3}

BUSINESS_TEXT_CELLS = {
    "legal_name": "Financial Plan!D6",
    "trading_name": "Financial Plan!D7",
    "phone": "Financial Plan!D12",
    "fax": "Financial Plan!G12",
    "email": "Financial Plan!D13",
    "naics": "Financial Plan!D20",
}


def load_sector_list(template: Path) -> list[str]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        import openpyxl
        sheet = openpyxl.load_workbook(template, data_only=True)["2"]
    return [str(sheet[f"B{row}"].value).strip() for row in range(9, 31)]


def year_index(target_year: int, status: str, today: date) -> int:
    """Index into the template's dynamic start-year dropdown ('2'!C45:C74).

    Row 46 evaluates to YEAR(TODAY())-1; each following row adds one year for
    a startup and subtracts one for an existing business. Index 1 is the
    'Year' header, so the first real year sits at index 2.
    """
    base = today.year - 1
    offset = target_year - base if status == "startup" else base - target_year
    index = 2 + offset
    if not 2 <= index <= 30:
        raise WorkbookEngineError(
            f"Start year {target_year} is outside the template's dropdown range for a "
            f"{status} business (supported: "
            f"{base if status == 'existing' else base} to "
            f"{base + 28 if status == 'startup' else base - 28})"
        )
    return index

def ye_year_index(target_year: int, status: str, today: date) -> int:
    """Index into the year-end dropdown ('2'!C75:C80): header + 5 years."""
    base = (today.year - 1) - (1 if status == "startup" else 2)
    index = 2 + (target_year - base)
    if not 2 <= index <= 6:
        raise WorkbookEngineError(
            f"Fiscal year-end year {target_year} is outside the template's dropdown range "
            f"(supported: {base} to {base + 4})"
        )
    return index


def business_assignments(business: dict, template: Path) -> tuple[dict[str, object], dict]:
    today = date.today()
    status = business.get("status")
    if status not in (None, "startup", "existing"):
        raise WorkbookEngineError("business.status must be 'startup' or 'existing'")
    assignments: dict[str, object] = {}
    intent: dict = {}

    if status:
        assignments["2!C3"] = 1 if status == "startup" else 2

    for key, cell in BUSINESS_TEXT_CELLS.items():
        if business.get(key) not in (None, ""):
            assignments[cell] = str(business[key])

    if business.get("address") not in (None, ""):
        address = business["address"]
        if isinstance(address, list):
            address = "\n".join(str(line) for line in address)
        assignments["Financial Plan!D8"] = address

    if business.get("form_of_company"):
        form = str(business["form_of_company"]).strip().lower()
        if form not in FORM_OF_COMPANY:
            raise WorkbookEngineError(
                f"form_of_company must be one of {sorted(FORM_OF_COMPANY)} (a co-operative "
                "or other form: leave it unset and note the form in the business plan)"
            )
        assignments["2!C5"] = FORM_OF_COMPANY[form]

    if business.get("industry_sector"):
        sectors = load_sector_list(template)
        wanted = str(business["industry_sector"]).strip().casefold()
        match = None
        for position, name in enumerate(sectors, start=1):
            folded = name.casefold()
            if wanted == folded or wanted in folded or folded in wanted:
                match = position
                break
        if match is None:
            raise WorkbookEngineError(
                f"industry_sector {business['industry_sector']!r} does not match the template "
                f"list: {sectors}"
            )
        assignments["2!C9"] = match

    if business.get("start_month"):
        month = int(business["start_month"])
        if not 1 <= month <= 12:
            raise WorkbookEngineError("start_month must be 1-12")
        assignments["2!C31"] = month + 1
        intent["start_month"] = month
    if business.get("start_year"):
        if not status:
            raise WorkbookEngineError("business.status is required when setting start_year")
        year = int(business["start_year"])
        assignments["2!C32"] = year_index(year, status, today)
        intent["start_year"] = year
    if business.get("fiscal_year_end_month"):
        month = int(business["fiscal_year_end_month"])
        if not 1 <= month <= 12:
            raise WorkbookEngineError("fiscal_year_end_month must be 1-12")
        assignments["2!C33"] = month + 1
        intent["ye_month"] = month
    if business.get("fiscal_year_end_year"):
        if not status:
            raise WorkbookEngineError("business.status is required when setting fiscal_year_end_year")
        year = int(business["fiscal_year_end_year"])
        assignments["2!C34"] = ye_year_index(year, status, today)
        intent["ye_year"] = year

    if business.get("export_percent") is not None:
        value = float(business["export_percent"])
        if not 0 <= value <= 1:
            raise WorkbookEngineError("export_percent must be a fraction between 0 and 1")
        assignments["Financial Plan!D21"] = value

    return assignments, intent


def parse_dates(dates: dict) -> dict[str, object]:
    parsed = {}
    for reference, value in dates.items():
        parsed[reference] = date.fromisoformat(str(value))
    return parsed


def verify_resolved_dates(shadow: Path, intent: dict) -> list[str]:
    if not intent:
        return []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        import openpyxl
        support = openpyxl.load_workbook(shadow, data_only=True)["2"]
    problems = []
    start, year_end = support["E6"].value, support["E7"].value
    if intent.get("start_month") and getattr(start, "month", None) != intent["start_month"]:
        problems.append(f"Resolved start date {start} does not match intended month {intent['start_month']}")
    if intent.get("start_year") and getattr(start, "year", None) != intent["start_year"]:
        problems.append(f"Resolved start date {start} does not match intended year {intent['start_year']}")
    if intent.get("ye_month") and getattr(year_end, "month", None) != intent["ye_month"]:
        problems.append(f"Resolved fiscal year end {year_end} does not match intended month {intent['ye_month']}")
    if intent.get("ye_year") and getattr(year_end, "year", None) != intent["ye_year"]:
        problems.append(f"Resolved fiscal year end {year_end} does not match intended year {intent['ye_year']}")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--payload", required=True, type=Path)
    parser.add_argument(
        "--template", type=Path, default=None,
        help="Pristine template to protect formulas against (default: bundled asset)",
    )
    parser.add_argument(
        "--keep-shadow", type=Path, default=None,
        help="Keep the recalculated shadow copy at this path (for rendering or audits)",
    )
    args = parser.parse_args()

    if not args.workbook.is_file():
        raise SystemExit(f"Workbook not found: {args.workbook}")
    template = args.template or pristine_template()
    payload = json.loads(args.payload.read_text(encoding="utf-8"))

    assignments: dict[str, object] = {}
    intent: dict = {}
    if payload.get("business"):
        business_cells, intent = business_assignments(payload["business"], template)
        assignments.update(business_cells)
    assignments.update(payload.get("cells", {}))
    assignments.update(parse_dates(payload.get("dates", {})))
    if not assignments and not payload.get("source_log"):
        raise SystemExit("Payload contains nothing to write")

    # Formula protection: refuse any target that is a formula cell in the
    # pristine template, before touching the workbook at all.
    protected = formula_inventory(template)
    conflicts = sorted(ref for ref in assignments if ref in protected)
    if conflicts:
        report = {
            "status": "refused",
            "reason": "assignments target formula cells of the template",
            "conflicts": [
                {"cell": ref, "template_formula": "=" + protected[ref]} for ref in conflicts
            ],
        }
        print(json.dumps(report, indent=2))
        raise SystemExit(2)

    write_report = inject_cells(args.workbook, assignments) if assignments else {"written": [], "refused": []}
    if write_report["refused"]:
        print(json.dumps({"status": "refused", **write_report}, indent=2))
        raise SystemExit(2)

    if payload.get("source_log"):
        add_values_sheet(args.workbook, "Source Log", payload["source_log"])

    with tempfile.TemporaryDirectory() as scratch:
        shadow = Path(scratch) / "shadow.xlsx"
        uno_recalculate(args.workbook, shadow)
        date_problems = verify_resolved_dates(shadow, intent)
        graft = graft_cached_values(args.workbook, shadow)
        if args.keep_shadow:
            args.keep_shadow.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(shadow, args.keep_shadow)

    # Integrity: every template formula must survive, verbatim.
    final = formula_inventory(args.workbook)
    missing = sorted(ref for ref in protected if ref not in final)
    altered = sorted(ref for ref in protected if ref in final and protected[ref] != final[ref])
    errors = cached_error_cells(args.workbook)

    report = {
        "status": "ok",
        "written": write_report["written"],
        "written_count": len(write_report["written"]),
        "source_log_added": bool(payload.get("source_log")),
        "recalculated_cells": graft,
        "template_formula_count": len(protected),
        "final_formula_count": len(final),
        "formulas_missing": missing,
        "formulas_altered": altered,
        "cached_formula_errors": errors[:50],
        "cached_formula_error_count": len(errors),
        "date_resolution_problems": date_problems,
        "parts": parts_summary(args.workbook),
    }
    failed = bool(missing or altered or errors or date_problems)
    if failed:
        report["status"] = "failed"
    print(json.dumps(report, indent=2, default=str))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
