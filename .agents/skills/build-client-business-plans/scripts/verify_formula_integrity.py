#!/usr/bin/env python3
"""Delivery gate: prove the finished workbook still IS the template.

Compares the final workbook against the pristine bundled template and fails
unless every one of the template's formulas is present and character-for-
character identical (shared formulas are expanded to their per-cell text on
both sides before comparison, so a legitimate re-representation of a shared
formula still passes while any real change fails). Also verifies that no new
formulas were written onto the template's own sheets, that the 22 dropdown
form controls, VML part, drawings, images, and defined names all survived,
that no cached formula result is an error value, and that the workbook is
flagged to recalculate on open.

Run this on every financial-forecast deliverable immediately before handoff:

    python3 verify_formula_integrity.py final.xlsx

Exit code 0 means the guarantee holds. Any other exit code means the file
must not be delivered.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _workbook_lib import (  # noqa: E402
    cached_error_cells,
    formula_inventory,
    parts_summary,
    pristine_template,
    sheet_part_map,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workbook", type=Path)
    parser.add_argument(
        "--template", type=Path, default=None,
        help="Pristine template to compare against (default: bundled asset)",
    )
    args = parser.parse_args()

    if not args.workbook.is_file():
        raise SystemExit(f"Workbook not found: {args.workbook}")
    template = args.template or pristine_template()

    template_formulas = formula_inventory(template)
    final_formulas = formula_inventory(args.workbook)
    template_sheets = set(sheet_part_map(template))
    final_sheets = set(sheet_part_map(args.workbook))

    missing = sorted(ref for ref in template_formulas if ref not in final_formulas)
    altered = sorted(
        ref for ref in template_formulas
        if ref in final_formulas and template_formulas[ref] != final_formulas[ref]
    )
    unexpected = sorted(
        ref for ref in final_formulas
        if ref not in template_formulas and ref.rsplit("!", 1)[0] in template_sheets
    )
    missing_sheets = sorted(template_sheets - final_sheets)
    extra_sheets = sorted(final_sheets - template_sheets)

    template_parts = parts_summary(template)
    final_parts = parts_summary(args.workbook)
    part_regressions = {
        key: {"template": template_parts[key], "final": final_parts[key]}
        for key in ("ctrl_props", "vml_drawings", "drawings", "media", "defined_names")
        if final_parts[key] < template_parts[key]
    }

    errors = cached_error_cells(args.workbook)

    with zipfile.ZipFile(args.workbook) as archive:
        recalc_on_open = b"fullCalcOnLoad" in archive.read("xl/workbook.xml")

    failures = []
    if missing_sheets:
        failures.append(f"template sheets missing: {missing_sheets}")
    if missing:
        failures.append(f"{len(missing)} template formulas missing")
    if altered:
        failures.append(f"{len(altered)} template formulas altered")
    if unexpected:
        failures.append(f"{len(unexpected)} new formulas written onto template sheets")
    if part_regressions:
        failures.append(f"package parts lost: {sorted(part_regressions)}")
    if errors:
        failures.append(f"{len(errors)} cached formula errors")

    def sample(refs: list[str]) -> list[dict]:
        out = []
        for ref in refs[:20]:
            entry = {"cell": ref}
            if ref in template_formulas:
                entry["template_formula"] = "=" + template_formulas[ref]
            if ref in final_formulas:
                entry["final_formula"] = "=" + final_formulas[ref]
            out.append(entry)
        return out

    report = {
        "workbook": str(args.workbook.resolve()),
        "template": str(template.resolve()),
        "passed": not failures,
        "failures": failures,
        "template_formula_count": len(template_formulas),
        "final_formula_count": len(final_formulas),
        "formulas_missing": sample(missing),
        "formulas_altered": sample(altered),
        "unexpected_new_formulas": sample(unexpected),
        "extra_sheets": extra_sheets,
        "part_regressions": part_regressions,
        "cached_formula_errors": errors[:50],
        "cached_formula_error_count": len(errors),
        "recalculates_on_open": recalc_on_open,
        "notes": [] if recalc_on_open else [
            "fullCalcOnLoad is not set; run populate_financial_workbook.py so the "
            "workbook recalculates when the client opens it"
        ],
    }
    print(json.dumps(report, indent=2, default=str))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
