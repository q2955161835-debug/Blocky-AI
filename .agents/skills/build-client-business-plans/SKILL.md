---
name: build-client-business-plans
description: Turn a Business Model Canvas, client intake form, notes, pitch deck, financial records, or incomplete business information into a researched first-draft business plan and an editable financial forecast. Use this skill whenever the user wants a business plan, financial projections or a forecast for a business, a lender- or funding-program-ready package, or asks to turn client information into plan documents, even when they only say "write a plan for my client", "build the financials", or attach intake notes. Ask only essential questions, research the industry and market with citations, complete the bundled Word and Excel templates through the protected workbook engine, reconcile the narrative with the numbers, label every assumption, add a downside and upside scenario appendix, and deliver editable .docx and .xlsx files. Currency and research jurisdiction default to Canada and CAD and adapt when the client clearly operates elsewhere.
---

# Build Client Business Plans

Create a professional, evidence-based first draft for the user's review. Use the bundled client intake, business-plan, and financial-forecast templates. Adapt irrelevant sections to the business without weakening the required document structure or financial controls.

## Required resources

- Use `assets/client-intake-template.docx` when the user needs an intake questionnaire.
- Use `assets/business-plan-template.docx` for the written business plan.
- Use `assets/financial-forecast-template.xlsx` for the financial appendix.
- Read `references/intake-and-assumptions.md` before questioning the user.
- Read `references/research-standards.md` before conducting research.
- Read `references/document-standards.md` in full before creating or editing any Word deliverable.
- Read `references/business-plan-map.md` before drafting the Word document.
- Read `references/financial-model-map.md` in full before touching the workbook. It documents the workbook engine and the input map; the engine scripts are the only supported way to write into the bundled template.
- Read `references/financial-model-audit.md` before designing, revising, or auditing the workbook.
- Run `scripts/check_word_document.py` on every final Word deliverable.
- Run `scripts/verify_formula_integrity.py` on every final workbook built from the bundled template.

## Core rules

1. Reuse every usable fact already supplied. Never ask for information that is present in an attachment or earlier message.
2. Ask only missing questions that materially affect the business model, research jurisdiction, financing request, or forecast.
3. Use a hybrid intake: ask one concise round of essential questions, then proceed with clearly labelled assumptions. Ask another question only if a missing fact makes the output misleading or mechanically impossible.
4. Never present an assumption as a client fact or a researched fact. Assign assumption IDs such as `A-01` and record the rationale, confidence, and effect.
5. Do not fabricate historical results, customers, contracts, credentials, permits, management biographies, or financing commitments.
6. Research current market, competitor, technology, demographic, regulatory, and benchmark information on the live web. Cite sources in the plan and log model inputs in the workbook's Source Log.
7. Default to Canada, CAD, Canadian NAICS, and federal, provincial, and municipal sources. When the client clearly operates in another jurisdiction, or the user names one, switch the research jurisdiction and currency to match and state the convention prominently. Never mix currencies inside one engagement; put any conversion in a visible, dated, sourced input. Infer province and municipality only from client-provided location data; otherwise label the geography as an assumption.
8. Treat financial projections as planning estimates, not audited statements, tax advice, legal advice, or a promise of financing.
9. Do not infer sensitive personal financial information. Leave director/backer personal financial schedules blank unless the user supplies the data and explicitly wants them completed.
10. Produce editable `.docx` and `.xlsx` files. Do not stop at an outline, chat summary, PDF, or static table when the user requested a complete draft.
11. Put the business name and production date in every deliverable filename. Use ISO format `YYYY-MM-DD` so files sort reliably.
12. Protect the workbook template's formulas absolutely. Never open a copy of the bundled template with openpyxl for writing, never re-save it through a spreadsheet application, and never run a generic recalculation script that rewrites it in place: those paths silently destroy 33 shared formulas and all 22 dropdown controls. Write into it only with `scripts/populate_financial_workbook.py`, which proves after every run that all 1,064 template formulas are intact.

## Word document standards

The standards in `references/document-standards.md` are mandatory for every Word deliverable, including an intake document. Apply them before drafting and enforce them again during final verification.

- Use only plain black-and-white Word formatting. No brand colours, theme accents, shading, highlighting, decorative graphics, coloured borders, or coloured hyperlinks.
- Use the named styles already present in `assets/business-plan-template.docx`: `Document Head`, `Document Subhead`, `Body Text`, `Heading 1`, `Heading 2`, `Heading 3`, `TOC Heading`, `Table title`, `Table Grid`, `Strong`, `Header`, `Footer`, and `Hyperlink` where applicable.
- Do not apply direct character or paragraph formatting to compensate for a style problem; fix the named style instead.
- Use no heading level deeper than `Heading 3`. Use decimal numbering in the body and lettered appendices.
- Use prose by default. Use a list or table only when it passes the eligibility rules in `references/document-standards.md`.
- Remove every drafting prompt, guidance paragraph, placeholder, unused table, blank filler row, and template-only traceability aid from the final client document.
- The Word standards never change the workbook: its layout, colours, formulas, validations, named ranges, and logic belong to the workbook engine alone.

## Workflow

### 1. Prepare a client case

Run `scripts/prepare_case.py` to copy the three pristine templates into a client-specific working folder. The script writes the business name and production date into every filename and onto the Word covers. Never edit the bundled assets themselves.

```bash
python3 scripts/prepare_case.py "Client or Business Name" --output-dir <working-directory>
```

The production date defaults to today; use `--date YYYY-MM-DD` only when the engagement requires a different documented date. Keep the intake copy only when it is useful to the engagement.

### 2. Build a fact inventory

Extract and classify all supplied information before asking questions:

- `CLIENT FACT`: explicitly supplied by the client/user
- `DOCUMENT FACT`: supported by an uploaded record
- `RESEARCHED FACT`: supported by a cited external source
- `ASSUMPTION`: estimated or inferred for drafting
- `OPEN ITEM`: material information still requiring confirmation

When a Business Model Canvas is supplied, map its nine blocks into the fact inventory. When notes conflict, surface the conflict instead of choosing silently.

### 3. Apply the hybrid intake

Use `references/intake-and-assumptions.md`. Ask one grouped round containing only unanswered essential questions, normally no more than eight. Explain that unanswered items will be modelled as assumptions. If the user is away or this is an unattended run, skip the question round, choose the most defensible interpretation, and record every choice in the assumption register.

After the response (or the decision to proceed):

1. Lock client facts.
2. Create the assumption register.
3. Continue drafting even if nonessential gaps remain.
4. Record unresolved items in `Items to confirm` instead of repeatedly interrupting.

### 4. Research the market

Use `references/research-standards.md`. Research the correct industry, customer geography, and regulatory jurisdiction as of the current date. Cover only what is relevant: industry definition and classification, size and outlook, target-market demographics and buying behaviour, direct and indirect competitors and substitutes, pricing or unit-economics benchmarks, technology and operating trends, applicable licences and taxes and standards, and material labour or supply risks.

Prefer bottom-up market sizing. When only top-down data exists, show the calculation and its limits. Never create false precision.

### 5. Design the forecast before writing conclusions

Build the operating logic first:

1. Define each revenue stream as units or customers multiplied by price and purchase frequency.
2. Define capacity constraints, ramp-up timing, seasonality, and collection timing.
3. Separate variable costs, direct labour, payroll, fixed operating expenses, capital purchases, working capital, taxes, and financing.
4. Define three scenarios: the base case that populates the workbook, and a downside and upside case expressed as changes to named drivers (for example volume −25%, price −10%, key cost +15%). Choose drivers from the risks actually identified in research, not generic percentages.
5. Reconcile profit, cash flow, financing need, and balance-sheet logic.

Do not write a confident growth story that the forecast cannot support.

### 6. Complete the financial workbook

Follow `references/financial-model-map.md` exactly. The short version:

```bash
# gate: structure, parts, and live year support
python3 scripts/check_financial_template.py <copy.xlsx> --start-year <YYYY> --status startup|existing

# pass 1: business identity and dates (writes dropdown selections, recalculates, verifies)
python3 scripts/populate_financial_workbook.py <copy.xlsx> --payload identity.json

# read the resolved period columns before entering numbers
python3 scripts/extract_workbook_outputs.py <copy.xlsx> --cells "Financial Plan!D26,Financial Plan!D27,...,2!E6,2!E7"

# pass 2: sales, costs, expenses, financing, monthly cash flow, source log
python3 scripts/populate_financial_workbook.py <copy.xlsx> --payload model.json

# scenario outcomes for the appendix (never modifies the file)
python3 scripts/extract_workbook_outputs.py <copy.xlsx> --scenario downside.json --cells "<key outputs>"
```

- Populate visible input cells only; the engine refuses formula cells and proves all 1,064 template formulas survived after every run. If a populate run reports `failed` or `refused`, stop and fix the payload; never work around the engine by editing the file another way.
- Leave missing historical periods blank or clearly marked `Not provided`; never invent history.
- Give every material input one authoritative cell, and record source, basis, and assumption ID for material inputs in the payload's `source_log`, which becomes a Source Log sheet in the workbook.
- Expose accounting-policy choices (asset lives, depreciation method, conventions) as visible inputs or Source Log entries; never bury a policy constant where the client cannot see it.
- Ensure projected sales, cost of sales, operating expenses, income statement, balance sheet, monthly cash flow, financing requirements, and ratios agree.
- Run the scenario extractions for the downside and upside cases and record revenue, net income, ending cash, and peak financing need for each; these feed the scenario appendix and must never be retyped by hand.

Before authoring, create the model-specific audit specification described in `references/financial-model-audit.md`. After the final populate run:

```bash
python3 scripts/audit_financial_model.py <final.xlsx> --spec <model-audit-spec.json>
python3 scripts/verify_formula_integrity.py <final.xlsx>
```

Do not deliver the workbook unless both commands exit successfully. Render the workbook to PDF, inspect every user-facing page, and fix visual problems. Dropdown selections do not draw in PDF renders; verify dates and choices from the extracted cells instead.

If the compatibility gate fails for a reason the engine cannot solve (for example a forecast horizon beyond three projected years), build the formula-driven fallback workbook defined in `references/financial-model-map.md` instead. The fallback is an ordinary new spreadsheet: general spreadsheet tooling and recalculation are appropriate there.

### 7. Complete the business-plan document

Use `references/document-standards.md` and `references/business-plan-map.md`, and edit the copied template with the docx-editing workflow (unzip, edit `word/document.xml`, rezip, validate) rather than regenerating the document from scratch.

- Start from the copied `assets/business-plan-template.docx`. Preserve its A4 page setup, section breaks, cover architecture, updateable TOC field, headers, footers, page fields, and approved named styles.
- Put the business name and production date on the cover, in the filename, and in any document control block.
- Map content to named styles; never imitate headings with bold body text.
- Replace every drafting prompt and placeholder with client-specific prose. Remove guidance notes, unused sections, unused tables, and the template traceability table before delivery.
- Create customer, supplier, employee, use-of-funds, action-plan, or risk tables only when at least three items are compared across at least two attributes.
- Include `Appendix A. Assumptions and items to confirm`, `Appendix B. Sources`, and `Appendix C. Scenario analysis`. Build Appendix C only from figures produced by the scenario extractions.
- Make every number in the narrative match the final workbook: pull the workbook figures with `extract_workbook_outputs.py` and use those values verbatim for financing requested, owner contribution, sales, gross margin, staffing, capital spending, profitability, and cash need.
- Refresh the TOC field after pagination is final.
- Render the DOCX to page images, inspect every page, and fix clipping, broken tables, awkward page breaks, leftover prompts, or blank pages before verification.

### 8. Verify every Word deliverable

```bash
python3 scripts/check_word_document.py <final-document.docx>
```

Do not deliver a Word file unless the command exits successfully. Fix every failure, regenerate or resave, render again, and rerun. At handoff, report the validator result as a short pass or fail list, plus which approved template styles were used and which were not needed.

### 9. Run the cross-document review

Before delivery, compare the Word plan and the workbook (using extracted values, not memory) for: business name, production date, location, legal form, start date, and currency; products, services, prices, channels, and segments; forecast periods and ramp-up dates; headcount and compensation; equipment, technology, leasehold, and working-capital needs; financing requested, sources and uses, owner contribution, loan terms, and repayment; annual revenue, gross profit, expenses, net income, cash balance, and break-even narrative; risks, mitigations, and the scenario figures in Appendix C.

Resolve discrepancies or flag them explicitly. Do not deliver conflicting figures.

### 10. Deliver the first draft

Return the final editable files, named:

- `<Business Name> - Business Plan Draft - <YYYY-MM-DD>.docx`
- `<Business Name> - Financial Forecast Draft - <YYYY-MM-DD>.xlsx`
- `<Business Name> - Client Intake - <YYYY-MM-DD>.docx` when an intake document is part of the engagement

Briefly state the main assumptions, the downside and upside headline numbers, and the most important items requiring client confirmation. Say that the documents are a first draft for professional review. Mention that the workbook recalculates itself when opened in Excel and that the dropdown selections are visible there even though PDF previews do not draw them.
