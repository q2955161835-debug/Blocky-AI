#!/usr/bin/env python3
"""Health-check a copy of the bundled financial template before modelling.

Verifies the workbook still has the required sheet architecture, the expected
volume of formulas, and the package parts (dropdown form controls, VML,
defined names) that generic spreadsheet tools silently destroy. Also reports
the date range the template can model.

The template's year dropdowns are formula-driven from TODAY(), so the years
visible in a saved file are only cached values from the last recalculation
(the bundled asset was last recalculated years ago). Do not judge year support
from cached values: this check computes the live range from today's date, and
populate_financial_workbook.py verifies the resolved dates again on the real,
recalculated workbook.

    python3 check_financial_template.py <copied-template.xlsx> \
        [--start-year YYYY] [--status startup|existing] [--forecast-end-year YYYY]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _workbook_lib import (  # noqa: E402
    formula_inventory,
    parts_summary,
    sheet_part_map,
)

REQUIRED_SHEETS = {"2", "Financial Plan", "Glossary", "UserGuide"}
EXPECTED = {"ctrl_props": 22, "vml_drawings": 1, "defined_names": 64}
PROJECTED_YEARS = 3


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--start-year", type=int, default=None)
    parser.add_argument("--status", choices=["startup", "existing"], default="startup")
    parser.add_argument("--forecast-end-year", type=int, default=None)
    args = parser.parse_args()

    if not args.workbook.is_file():
        raise SystemExit(f"Workbook not found: {args.workbook}")

    sheets = sheet_part_map(args.workbook)
    missing_sheets = sorted(REQUIRED_SHEETS - set(sheets))
    formulas = formula_inventory(args.workbook)
    financial_formulas = sum(1 for ref in formulas if ref.startswith("Financial Plan!"))
    parts = parts_summary(args.workbook)

    today = date.today()
    dropdown_base = today.year - 1
    if args.status == "startup":
        supported_start = (dropdown_base, dropdown_base + 28)
    else:
        supported_start = (dropdown_base - 28, dropdown_base)

    warnings: list[str] = []
    if missing_sheets:
        warnings.append(f"Missing required sheets: {', '.join(missing_sheets)}")
    if financial_formulas < 900:
        warnings.append(
            f"Financial Plan holds {financial_formulas} formulas; the pristine template "
            "holds 921. Formulas have been lost: discard this copy and re-run "
            "prepare_case.py."
        )
    for key, expected in EXPECTED.items():
        if parts[key] < expected:
            warnings.append(
                f"Package part regression: {key}={parts[key]} (template has {expected}). "
                "The copy was probably re-saved by a spreadsheet tool: discard it and "
                "re-run prepare_case.py."
            )

    start_year_ok = True
    if args.start_year is not None:
        start_year_ok = supported_start[0] <= args.start_year <= supported_start[1]
        if not start_year_ok:
            warnings.append(
                f"Start year {args.start_year} is outside the live dropdown range "
                f"{supported_start[0]}-{supported_start[1]} for a {args.status} business"
            )

    forecast_ok = True
    if args.forecast_end_year is not None:
        anchor = args.start_year or today.year
        latest = anchor + PROJECTED_YEARS - 1
        forecast_ok = args.forecast_end_year <= latest
        if not forecast_ok:
            warnings.append(
                f"Requested forecast end year {args.forecast_end_year} exceeds the "
                f"template's {PROJECTED_YEARS} projected annual periods from "
                f"{anchor} (latest supported: {latest}). Use the fallback workbook "
                "for longer horizons."
            )

    compatible = not missing_sheets and financial_formulas >= 900 and start_year_ok and forecast_ok
    report = {
        "path": str(args.workbook.resolve()),
        "sheets": sorted(sheets),
        "missing_required_sheets": missing_sheets,
        "financial_plan_formula_count": financial_formulas,
        "total_formula_count": len(formulas),
        "parts": parts,
        "year_support": {
            "computed_on": today.isoformat(),
            "status_assumed": args.status,
            "supported_start_years": supported_start,
            "projected_annual_periods": PROJECTED_YEARS,
            "note": (
                "Year dropdowns derive from TODAY(); cached year values in the file are "
                "stale until populate_financial_workbook.py recalculates it."
            ),
        },
        "template_candidate": compatible,
        "warnings": warnings,
        "next_step": (
            "Populate with populate_financial_workbook.py."
            if compatible
            else "Fix the issue above or build the fallback workbook per references/financial-model-map.md."
        ),
    }
    print(json.dumps(report, indent=2))
    if not compatible:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
