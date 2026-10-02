# Financial Forecast Template Map

## Contents

- Why the workbook engine exists
- The engine pipeline
- Payload reference
- Workbook architecture
- Input map: business information and dropdowns
- Input map: model sections
- Two-pass population workflow
- Modelling rules
- Default forecast conventions
- Currency and jurisdiction
- Assumption and source discipline
- Scenario cases
- Required checks
- Template compatibility gate
- Formula-driven fallback workbook
- Revision black-line

## Why the workbook engine exists

The bundled template is a professionally built lender-style model: 1,064 formulas (921 on `Financial Plan`, 143 on the hidden support sheet), 603 of them stored as legacy shared formulas, plus 22 dropdown form controls wired to the hidden sheet, 64 named ranges, and embedded images. Two ordinary editing paths corrupt it silently:

- openpyxl cannot resolve 33 of the shared-formula followers (balance-sheet rows 197–257). Opening and saving the file with openpyxl deletes those formulas and strips every form control, VML part, and image without any error.
- Any spreadsheet application round trip (including LibreOffice conversions and generic in-place recalculation scripts) preserves the formulas but strips all 22 dropdown controls.

The engine scripts avoid both paths. They edit cell values surgically inside the xlsx package so every other byte survives, hard-recalculate a disposable shadow copy in headless LibreOffice, graft the freshly computed results back into the untouched original as cached values, and then prove, cell by cell, that the finished file still contains every template formula character-for-character. The delivered workbook also carries the recalculate-on-open flag, so Excel recomputes everything, including its TODAY()-driven date logic, the moment the client opens it.

Consequences you must respect:

- Read the workbook with openpyxl freely; never save with it.
- Never run a recalculation utility that rewrites the deliverable in place.
- All writes go through `populate_financial_workbook.py`. If it reports `refused` or `failed`, fix the payload; do not route around it.
- `verify_formula_integrity.py` is the delivery gate. A file that fails it is not deliverable, whatever it looks like.

## The engine pipeline

```bash
# 1. health check (structure, parts, live year support)
python3 scripts/check_financial_template.py <copy.xlsx> \
    --start-year 2026 --status startup --forecast-end-year 2028

# 2. write values (validates -> injects -> recalculates shadow -> grafts -> verifies)
python3 scripts/populate_financial_workbook.py <copy.xlsx> --payload payload.json
#    add --keep-shadow shadow.xlsx to keep the recalculated copy for inspection

# 3. read recalculated values (reconciliation, headers, key outputs)
python3 scripts/extract_workbook_outputs.py <copy.xlsx> --cells "Financial Plan!D145,2!E6"

# 4. scenario outcomes on a throwaway copy (file on disk never changes)
python3 scripts/extract_workbook_outputs.py <copy.xlsx> \
    --scenario downside.json --cells "Financial Plan!D145,Financial Plan!D156"

# 5. delivery gates
python3 scripts/audit_financial_model.py <copy.xlsx> --spec model-audit-spec.json
python3 scripts/verify_formula_integrity.py <copy.xlsx>
```

Each populate run takes a few seconds and ends with a JSON report: `written`, `recalculated_cells`, `formulas_missing`/`formulas_altered` (must be empty), `cached_formula_error_count` (must be 0), `date_resolution_problems` (must be empty), and a parts summary (22 ctrl_props, 1 vml, 64 defined names). Read the report every time.

## Payload reference

```json
{
  "business": {
    "status": "startup",
    "legal_name": "Maple Grove Consulting Inc.",
    "trading_name": "Maple Grove Consulting",
    "address": ["945 Princess Street, Suite 200", "Kingston, ON K7L 3N6"],
    "phone": "613-555-0142", "fax": "", "email": "hello@example.com",
    "form_of_company": "corporation",
    "industry_sector": "Professional, Scientific, and Technical Services",
    "naics": "541611",
    "start_month": 9, "start_year": 2026,
    "fiscal_year_end_month": 8, "fiscal_year_end_year": 2027,
    "export_percent": 0.0
  },
  "cells": {
    "Financial Plan!B28": "Consulting engagements",
    "Financial Plan!D28": 180000
  },
  "dates": { "Financial Plan!D16": "2020-04-01" },
  "source_log": [
    ["ID","Cell","Value","Basis","Source","URL","Accessed","Notes"],
    ["A-01","Financial Plan!D28",180000,"Planning assumption","Client interview","","2026-08-28","12 engagements x $15,000"]
  ]
}
```

- `business` translates client facts into the right cells and dropdown indexes, including the date dropdowns, and the engine verifies after recalculation that the resolved start and year-end dates (`2!E6`, `2!E7`) match the intent. `status` is required whenever years are set.
- `form_of_company` accepts corporation, partnership, or proprietorship (the template's own three options). For a co-operative or other form, leave it unset and cover the legal form in the plan narrative.
- `industry_sector` is matched against the template's own 22-sector list; the report fails with the list if no match is found.
- `cells` writes any visible input cell, addressed `Sheet!REF`. Text and numbers only; percentages are fractions (0.15, not 15).
- `dates` writes ISO dates as real Excel date serials (for the existing-business date fields).
- `source_log` appends a values-only `Source Log` sheet; use it for every material researched or assumed input.

## Workbook architecture

Preserve all four template sheets:

- `2`: hidden support sheet holding dropdown lists, the chosen index for every dropdown, and the TODAY()-driven date and period logic
- `Financial Plan`: the single input, calculation, and output sheet
- `Glossary`: accounting-term definitions
- `UserGuide`: template instructions

The engine may add one extra sheet, `Source Log`. Never delete, rename, unhide, or restyle the template sheets.

## Input map: business information and dropdowns

Visible identity inputs on `Financial Plan` (handled by the payload's `business` block): D6 legal name, D7 trading name, D8 address (merged block, newlines allowed), D12 phone, G12 fax, D13 e-mail, D20 NAICS code, D21 export fraction. D14 (form of company) and the business-sector display are formulas fed by dropdowns; never write them directly.

The dropdowns are form controls whose selections live as indexes on sheet `2`. The engine sets them from the `business` block; set them through `cells` only for the rare cases the block does not cover:

| Linked cell | Meaning | Index logic |
|---|---|---|
| `2!C3` | New (1) or existing (2) business | option buttons |
| `2!C5` | Form of company | 1 corporation, 2 partnership, 3 proprietorship |
| `2!C9` | Industry sector | position in the 22-item list on `2!B9:B30` |
| `2!C31` | Start month | month + 1 (index 1 = automatic) |
| `2!C32` | Start year | dynamic year list from TODAY(); use the `business` block |
| `2!C33` | Fiscal year-end month | month + 1 |
| `2!C34` | Fiscal year-end year | dynamic; use the `business` block |
| `2!C35`, `2!C36` | Interim statement month and choice | leave at defaults unless modelling an interim period |
| `2!D47:D55` | Existing-loan type, frequency, and term dropdowns | see the loan lists on `2!B94:B111` |
| `2!E47:E49` | Director schedule marital-status dropdowns | leave blank unless the client supplies personal data |

The year dropdowns are formula-driven from TODAY(), so a startup can start in any year from last year to 28 years out, and an existing business can have started up to 28 years back. Cached year values visible in an unrecalculated file are stale; trust the engine's date-resolution check, not what a preview shows.

After the identity pass, confirm the resolved dates and period columns from the recalculated values: `2!E6` (start date), `2!E7` (first fiscal year end), and the period headers in `Financial Plan` rows 26–27.

Dropdown selections do not draw in PDF renders of the workbook; they are visible in Excel. Verify selections from extracted cells, never from a PDF page.

## Input map: model sections

Period columns depend on the configuration; read the headers in rows 26–27 after the identity pass. For a startup with no history, D, E, F are projected years 1–3 and G–J stay empty. For an existing business, earlier columns carry historical years and an optional interim column, with projections following.

| Rows | Section | Input rows (write) | Formula rows (never write) |
|---|---|---|---|
| 3–22 | Business information | identity cells above | labels, D14, computed labels |
| 23–45 | Sales | B28:B32 stream names; period columns of rows 28–32; B43:B45 assumption text | 26–27 headers, 33 total, 35–40 sales mix |
| 48–88 | Cost of sales | 52–56 materials, freight, inventory; 58–63 direct labour, repairs, utilities, depreciation, overhead, other; 81+ assumption text | 51, 57, 64, 66–79 ratios |
| 89–137 | Operating expenses | 91–96 selling; 98–108 admin; 110 R&D; 135+ assumption text | 90, 97, 109, 111, 112–133 ratios |
| 141–168 | Income statement | 155 taxes; notes | everything else |
| 170–271 | Statements of financial position | opening-position inputs for an existing business only | projected statements |
| 273–365 | Monthly cash flow | see the block layout below | block totals, surplus/deficit, cash/loan required |
| 367–423 | Financial requirements | 370–374 capital purchases by year; 377 working capital; 384–412 existing-loan details; notes | totals 376, 382 |
| 426–445 | Performance indicators | none | all ratios |
| 448–570 | Director/backer schedules | only client-supplied personal data, on explicit request | subtotals |

The engine refuses any write that targets a formula cell, so an honest mistake in row selection fails loudly instead of corrupting the model. When a section's exact input cell is uncertain, read the rows first (openpyxl reading is safe) and locate the label.

### Monthly cash-flow block layout

The 24 months run in four six-month blocks, each with columns D–I as its six months:

| Block | Months | Rows | Receipts inputs | Payment inputs | Opening cash |
|---|---|---|---|---|---|
| 1 | 1–6 | 275–293 | 276–279 | 281–289 | D292 is the only input (starting cash); E292:I292 roll forward by formula |
| 2 | 7–12 | 295–313 | 296–299 | 301–309 | formulas |
| 3 | 13–18 | 316–334 | 317–320 | 322–330 | formulas |
| 4 | 19–24 | 336–354 | 337–341 | 343–351 | formulas |

Write the starting cash into D292 only. Every later month's opening cash is `=IF(prior close>0, prior close, 0)`, so the engine will refuse writes there; a negative prior close opens the next month at zero, which is the template's convention for cash carried as "loan required". The block-title year labels can display oddly for some startup configurations; the period columns and dates still resolve correctly, so verify periods from `2!E6`/`2!E7` and the row-26/27 headers, and note the label quirk in the workbook notes if it appears.

### Template repairs in this bundle

The bundled template is the consultant's original file with three surgical formula repairs, applied after a full audit found them defective as shipped (every other byte is identical, and the audit verified all repaired chains empirically):

1. `Financial Plan!D186` (first balance-sheet block, Net Fixed Assets) was `=SUM(D190)`, which omitted fixed assets from total assets and double-counted other assets; now `=SUM(D181:D185)`, matching the correct formula in balance-sheet blocks 2–4.
2. `Financial Plan!E292:G292` (opening cash, months 2–4) were blank inputs where every other month has a roll-forward formula; now `=IF(D293>0,D293,0)` and analogues.
3. `Financial Plan!D333` (month-13 opening cash) compared against stray empty cell `K3380`; now `>0` like its siblings.

`verify_formula_integrity.py` compares against this repaired template, so the repairs are part of the protected 1,064-formula baseline.

For a startup, the projected statements of financial position (rows 170–271) are largely driven by opening-position inputs that only an existing business has, so much of that section legitimately stays blank. Derive year-end positions (cash, equipment net of depreciation, loan balance, equity) from the model outputs and present them in the business plan when the lender package needs them, and say in the workbook notes why the section is blank.

## Two-pass population workflow

1. **Identity pass.** Payload with the `business` block (plus existing-business `dates`). Run populate; confirm `date_resolution_problems` is empty.
2. **Header read.** Extract rows 26–27 and `2!E6`, `2!E7` to learn which columns are which periods.
3. **Model pass.** Payload with `cells` for sales, cost of sales, expenses, taxes, capital purchases, working capital, loans, and the monthly cash-flow rows, plus `source_log`. Annual totals must agree with monthly collections after timing differences.
4. **Output read.** Extract income-statement, cash-flow, and financing outputs for the narrative, the audit specification, and the reconciliation.

More passes are fine; each is a few seconds and re-verifies everything.

## Modelling rules

1. Change input cells only; the engine enforces this, and the fallback workbook must follow the same discipline by convention.
2. Use one row per material revenue stream, up to the five available rows. Show the `volume x price x frequency` logic in the sales-assumption text rows and the Source Log even though the sales rows receive the calculated value.
3. Use realistic ramp-up, capacity, seasonality, and collection timing. Make annual sales agree with monthly cash collections after timing differences.
4. Separate cost of sales from operating expenses. Tie direct labour and purchases to the operating model.
5. Tie capital purchases to the financial-requirements section and to depreciation; tie loans to financing sources, interest, repayments, and the cash flow.
6. Make the financing request equal what the model shows is needed: compare peak cash deficit with requested financing plus owner contribution and explain any gap.
7. Keep historical actuals distinct from projections. Never populate historical columns with forecast assumptions.
8. Leave the director/backer personal schedules blank unless the user supplies the data and explicitly wants them completed.

## Default forecast conventions

- Whole-dollar presentation, no decimals in money cells.
- Use the business's fiscal year. If unknown, ask once; if still unknown, assume a year end twelve months after start and label the assumption.
- For a startup, populate monthly cash flow for at least the first 24 months (both monthly blocks) and all three projected annual years.
- For an existing business, use the historical periods the client can actually provide and three projected years.
- The workbook carries the base case. Downside and upside live in the scenario extractions and Appendix C of the plan, not in extra sheets, unless the user asks for separate scenario workbooks.

## Currency and jurisdiction

Default to CAD and Canada-first research. Switch when the client clearly operates in another jurisdiction or the user names one: research that jurisdiction, express every figure in its currency, and state the convention on the workbook (business-information notes), in the Source Log, and in the plan. The template's arithmetic is currency-neutral; what matters is that one currency is used everywhere and named clearly. Any converted figure gets a visible, dated, sourced conversion entry in the Source Log. Never mix currencies, and never restate the client's actuals into another currency silently.

## Assumption and source discipline

- Use client facts for known prices, payroll, contracts, leases, debts, and quotes.
- Use researched benchmarks only when client data is unavailable; cite them.
- Every material researched or estimated input gets a Source Log row: ID, cell, value, basis, source, URL, access date, notes.
- Give each material fact one authoritative input cell; a value may appear elsewhere only through the template's own formulas.
- The assumption register in the plan and the Source Log in the workbook must tell the same story with the same IDs.

## Scenario cases

Define downside and upside as named driver changes grounded in the identified risks (volume, price, key cost, timing), not symmetrical guesses. Run each through the scenario extractor against the finished base-case workbook and capture at minimum: total revenue by year, net income by year, ending cash or peak cash need, and the financing implication. Copy the extracted numbers into Appendix C verbatim. If a scenario breaks the financing logic (peak deficit beyond financing), say so in the plan; that is the point of the exercise.

## Required checks

- `populate_financial_workbook.py` final run: status ok, no missing or altered formulas, no cached errors, no date problems, parts intact
- Revenue totals agree across sales section, income statement, monthly cash flow, and narrative
- Cost totals and gross margin internally consistent and reasonable for the industry
- Headcount and payroll agree with the plan
- Capital purchases, depreciation, and financial requirements agree
- Loan proceeds, interest, principal, and financing uses agree
- Monthly opening and closing cash roll forward; annual and monthly views reconcile
- Peak cash deficit versus financing explained
- Performance ratios reference sensible periods
- Personal financial schedules blank unless intentionally completed
- Key outputs independently recomputed outside the workbook: revenue, gross profit, operating profit, net income, ending cash, financing need
- Perturbation: one representative revenue, cost, and financing input each moved on a scenario run, with dependent outputs moving the expected direction
- `audit_financial_model.py` passes against the pre-authored specification
- `verify_formula_integrity.py` passes

## Template compatibility gate

Run `check_financial_template.py` with the case's start year and status before modelling. Use the fallback workbook when any of these holds:

- the engagement needs more than three projected annual years or more than 24 monthly periods
- the client requires currency-specific formatting or statements the template cannot present
- the check reports missing sheets, lost formulas, or part regressions that re-copying from the pristine template does not cure
- the model requires structures the template lacks (multiple entities, consolidated statements, more than five revenue streams that cannot be sensibly grouped)

Do not return the template blank, and do not spend unlimited time forcing a mismatched engagement into it.

## Formula-driven fallback workbook

When the gate fails, build a new editable `.xlsx` from scratch. This is an ordinary new spreadsheet: openpyxl and a standard recalculation pass are appropriate here, and the constraints above about the template do not apply. Retain the analytical coverage of the template with these sheets:

1. `Summary`: business identity, scenario, currency convention, financing need, revenue, gross margin, net income, ending cash, model status
2. `Assumptions`: all editable client facts and numbered planning assumptions, including financing uses, reserves, and accounting-policy inputs
3. `Revenue`: streams, units, price, frequency, capacity, ramp-up, seasonality, annual rollups
4. `Costs`: cost of sales, payroll, fixed expenses, capital spending by asset class and vintage, depreciation linked to visible policy cells, working-capital drivers
5. `Income Statement`: monthly first-year detail where useful and at least three projected years
6. `Balance Sheet`: assets, liabilities, debt, equity, visible balance check
7. `Cash Flow`: at least 24 monthly periods for a startup, financing proceeds and debt service included
8. `Financing`: sources and uses, owner contribution, loan terms, repayment schedule, peak cash need
9. `Checks`: formula errors, revenue tie-out, cash roll-forward, balance check, sources and uses, lineage and formula-family controls, model status
10. `Sources`: assumption ID, value, units, period, source, URL, access date, notes

Keep formulas simple and auditable: blue font for editable inputs, black for formulas, green for cross-sheet links, clear currency formats. Name the file `<Business Name> - Financial Forecast Draft - <YYYY-MM-DD>.xlsx`. The fallback still faces `audit_financial_model.py` with a full specification; `verify_formula_integrity.py` applies only to workbooks built from the bundled template.

## Revision black-line

When revising an existing model, record each material change in an internal review log: sheet and cell, previous logic, revised logic, rationale with assumption/source ID, before-and-after effect on revenue, operating profit, net income, ending cash, debt, financing need, and the balance check, and any unresolved accounting or client decision. If the correct treatment depends on an unconfirmed decision, expose it as a labelled input and flag it; do not choose a hidden constant to force reconciliation.
