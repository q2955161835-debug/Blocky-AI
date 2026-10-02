# Financial Model Audit Gate

Use this gate for every completed or revised financial workbook. It supplements the engine's formula-integrity gate because a workbook can keep every template formula intact and still be logically wrong: inputs in the wrong periods, duplicated hardcodes in a fallback workbook, unsupported policies, or numbers that disagree with the narrative.

## Required sequence

1. Before authoring, create a JSON audit specification from the approved model design and assumption register. Write it from the intended design, never by copying from the finished workbook, so it can catch an implementation that is internally consistent but wrong.
2. Populate the workbook through the engine (`populate_financial_workbook.py`), or build the fallback workbook with ordinary spreadsheet tooling.
3. Confirm the final populate report is clean (or, for a fallback, that a recalculation pass ran).
4. Render the workbook to PDF and inspect every user-facing page.
5. Perturb representative revenue, operating-cost, and financing inputs with `extract_workbook_outputs.py --scenario` and confirm the dependent outputs move in the expected direction. Scenario runs never modify the deliverable, so no cleanup is needed.
6. Independently recompute revenue, gross profit, operating profit, net income, ending cash, and financing need from the raw inputs, outside the workbook, and put the expected values into `numeric_checks`.
7. Run `python3 scripts/audit_financial_model.py <final.xlsx> --spec <spec.json>`.
8. Fix every failure and rerun until the audit exits successfully. For template workbooks, finish with `verify_formula_integrity.py`.

## Specification schema

Only `required_sheets` is mandatory, but every applicable control below belongs in a client model.

```json
{
  "required_sheets": ["2", "Financial Plan", "Glossary", "UserGuide", "Source Log"],
  "min_formula_count": 1000,
  "allow_external_links": false,
  "input_cells": ["Financial Plan!D28", "Financial Plan!D98"],
  "formula_cells": ["Financial Plan!D33", "Financial Plan!D145", "Financial Plan!D156"],
  "policy_inputs": [
    {"cell": "Assumptions!B57", "label": "Equipment useful life"},
    {"cell": "Assumptions!B58", "label": "Depreciation method", "allowed": ["Straight-line"]}
  ],
  "authoritative_links": [
    {"target": "Summary!G4", "source": "Assumptions!B53", "direct_only": true}
  ],
  "formula_requirements": [
    {
      "cells": ["Costs!B15", "Costs!C15"],
      "must_reference_all": ["Assumptions!B57"],
      "forbid_regex": ["/[ ]*(5|10)(?![0-9])"]
    }
  ],
  "copy_series": [
    {"name": "Monthly ending cash", "range": "Cash Flow!B24:Y24"}
  ],
  "status_cells": [
    {"cell": "Checks!F3", "equals": "PASS"}
  ],
  "numeric_checks": [
    {"left": "Financial Plan!D145", "expected": 210000, "tolerance": 1.0},
    {"left": "Financial Plan!D145", "right": "Financial Plan!D33", "tolerance": 1.0}
  ]
}
```

Field notes:

- For template workbooks, `min_formula_count` of 1000 guards the 1,064-formula inventory; `input_cells` should name the material inputs you populated; `formula_cells` should name the key outputs. `policy_inputs`, `authoritative_links`, `formula_requirements`, `copy_series`, and `status_cells` matter most for fallback workbooks, where you author the formulas yourself.
- `status_cells` and `numeric_checks` read cached values. Engine-populated workbooks always have fresh cached values (the graft step writes them); a missing cached result in a fallback workbook means it was never recalculated.
- Use `allowed` on a policy input only when the client, an accountant, or a documented assumption established the value. If a policy is still open, keep the input visible, give it an assumption ID, and report the open decision instead.
- `must_reference_all` requires each listed formula to reference every listed cell; `forbid_regex` rejects hidden constants (for example a hardcoded `/5` life where a policy cell should be referenced).
- `copy_series` compares formulas across a range after translating them to a common origin; list intentional exceptions in `exceptions` rather than weakening the test.
- Use `numeric_checks.expected` for independently computed key outputs and `right` for internal tie-outs.

## Revision evidence

For material revisions, keep an internal black-line log with old logic, new logic, rationale, assumption/source ID, and downstream impact on revenue, operating profit, net income, ending cash, debt, financing need, and the balance check. If a reviewer proposes a specific accounting policy, adopt the control improvement but do not adopt the policy value without support.
