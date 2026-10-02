#!/usr/bin/env python3
"""Read recalculated values out of a workbook, optionally under scenario overrides.

Three uses:

1. Reconciliation reads: pull the workbook figures the business-plan narrative
   must match (revenue, net income, ending cash, financing need).

       python3 extract_workbook_outputs.py final.xlsx \
           --cells "Financial Plan!D33,Financial Plan!G160"

2. Scenario runs: apply temporary input overrides to a throwaway copy,
   hard-recalculate it, and read the outcomes. The workbook on disk is never
   modified, so downside/upside sensitivity cases cost nothing.

       python3 extract_workbook_outputs.py final.xlsx \
           --scenario downside.json --cells "Financial Plan!D33,..."

   where downside.json is {"cells": {"Financial Plan!D28": 90000, ...}}

3. Perturbation tests: verify that changing a representative input actually
   moves its dependent outputs (see references/financial-model-audit.md).

Values come from cached results. Without --scenario the file must already
have been through populate_financial_workbook.py (which grafts fresh values);
cells that have never been recalculated read as null and are reported.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _workbook_lib import (  # noqa: E402
    formula_inventory,
    inject_cells,
    pristine_template,
    split_sheet_ref,
    uno_recalculate,
)


def read_cells(workbook: Path, references: list[str]) -> dict[str, object]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        import openpyxl
        cached = openpyxl.load_workbook(workbook, data_only=True)
    result = {}
    for reference in references:
        sheet, cell = split_sheet_ref(reference)
        if sheet not in cached.sheetnames:
            result[reference] = {"error": f"missing sheet {sheet}"}
            continue
        result[reference] = cached[sheet][cell].value
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workbook", type=Path)
    parser.add_argument(
        "--cells", required=True,
        help="Comma-separated cell references, e.g. \"Financial Plan!D33,2!E6\"",
    )
    parser.add_argument(
        "--scenario", type=Path, default=None,
        help="JSON file with a 'cells' map of temporary input overrides",
    )
    parser.add_argument(
        "--template", type=Path, default=None,
        help="Pristine template for formula protection during scenario overrides",
    )
    args = parser.parse_args()

    if not args.workbook.is_file():
        raise SystemExit(f"Workbook not found: {args.workbook}")
    references = [ref.strip() for ref in args.cells.split(",") if ref.strip()]

    if args.scenario is None:
        values = read_cells(args.workbook, references)
        unrecalculated = [ref for ref, value in values.items() if value is None]
        print(json.dumps({
            "mode": "cached",
            "values": values,
            "unrecalculated_or_empty": unrecalculated,
        }, indent=2, default=str))
        return

    scenario = json.loads(args.scenario.read_text(encoding="utf-8"))
    overrides = scenario.get("cells", {})
    if not overrides:
        raise SystemExit("Scenario file has no 'cells' overrides")

    template = args.template or pristine_template()
    protected = formula_inventory(template)
    conflicts = sorted(ref for ref in overrides if ref in protected)
    if conflicts:
        print(json.dumps({
            "mode": "scenario",
            "status": "refused",
            "reason": "scenario overrides target formula cells",
            "conflicts": conflicts,
        }, indent=2))
        raise SystemExit(2)

    with tempfile.TemporaryDirectory() as scratch:
        copy = Path(scratch) / "scenario.xlsx"
        shadow = Path(scratch) / "shadow.xlsx"
        shutil.copy2(args.workbook, copy)
        report = inject_cells(copy, overrides)
        if report["refused"]:
            print(json.dumps({"mode": "scenario", "status": "refused", **report}, indent=2))
            raise SystemExit(2)
        uno_recalculate(copy, shadow)
        values = read_cells(shadow, references)

    print(json.dumps({
        "mode": "scenario",
        "status": "ok",
        "overrides_applied": len(overrides),
        "values": values,
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
