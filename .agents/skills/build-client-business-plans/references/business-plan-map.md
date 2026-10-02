# Business Plan Template Map

## Output standard

Create a lender- and advisor-readable first draft in the bundled Word template. Apply `references/document-standards.md` without exception. Replace all prompts with business-specific prose and remove every drafting note, placeholder, unused table, and template-only traceability aid before delivery. State the currency convention (CAD by default, the client's jurisdiction otherwise) wherever money first appears.

## Approved template styles

Apply styles by name. Do not create a replacement style or use direct formatting to imitate one.

| Purpose | Named style |
|---|---|
| Cover title | `Document Head` |
| Cover business name | `Document Subhead` |
| Body paragraphs | `Body Text` |
| Main body sections | `Heading 1` |
| Subsections | `Heading 2` |
| Third-level subsections | `Heading 3` |
| TOC title | `TOC Heading` |
| TOC entries | `toc 1`, `toc 2`, `toc 3` |
| Table captions | `Table title` |
| Tables | `Table Grid` |
| Table-header text | `Strong` |
| Running header | `Header` |
| Running footer | `Footer` |
| Visible links | `Hyperlink` |

The bundled template contains legacy styles retained for compatibility with the supplied source file. Do not use `Cover`, `Section Head`, `Introduction`, `Heading 4` through `Heading 9`, `Table - Liste`, `Table - Simple`, note styles, coloured-text styles, or decorative BDC styles in a client deliverable.

## Section map

### 0. Executive summary

- Project objectives
- Business description
- Products and services
- Financing need
- Management
- Risks and contingencies

Write this section last. Summarize the final strategy and figures rather than introducing new claims. Keep the risk summary brief and refer to section 5.7 for the detailed register.

### 1. Business overview

- Business description
- Mission, vision, and values
- Industry overview and trends
- Technology trends
- Government regulation
- Market analysis
  - Market trends
  - Target market
  - Products and services
- Competition
  - Competitor strengths and weaknesses
  - Competitive advantage

Use researched evidence. Connect the target market and competitive position to the revenue forecast and to the choices in section 5.

### 2. Sales and marketing

- Customers or customer segments
- Suppliers
- Advertising and promotion
- Pricing and distribution
- Customer service and warranties

Name customers and suppliers only when the client confirms them. When customers are not contracted, describe customer segments in prose. Create a customer or supplier table only when at least three confirmed organizations can be compared across at least two attributes.

### 3. Operating plan

- Business location
- Equipment
- Technology requirements
- Environmental and operating compliance

Reconcile premises, capital purchases, leases, maintenance, technology, compliance, and staffing with the workbook.

### 4. People

- Management team
- Advisory team
- Employees

Use only client-supplied names, roles, biographies, and qualifications. Do not research private individuals to fill gaps unless the user specifically requests public-profile research.

### 5. Strategic business implementation

Use this chapter to convert the analysis in sections 1 to 4 into decisions, resource requirements, responsibilities, timing, and measurable controls.

#### 5.1 Market entry and positioning

State the first customer segment, why it precedes the others, the evidence supporting the position, the entry barriers, the segment sequence, and the trigger for each later segment. Name positions that were considered and rejected. Summarize the first 90 days of entry activity without duplicating the detailed roadmap.

#### 5.2 Business model rationale

Explain each revenue line, expected revenue share, price, direct cost, contribution margin, break-even volume, capacity constraint, and cash-cycle effect. Name the alternative models considered and explain why the selected model is more suitable. State the conditions required for the model to work and the activities that create or reduce margin.

#### 5.3 Strategic goals

Set three to five goals. Give each goal a baseline, target, date, owner, leading indicator, lagging indicator, and the constraint it removes. State the primary measure of strategic progress, the review cadence, and the material activities the business will not pursue during the period.

#### 5.4 Project objectives

Define the specific funded project without repeating the longer strategic goals. State what will be built, bought, launched, or hired; what the project includes and excludes; the target completion date; the completion test; the expected revenue or savings; and the strategic goal it supports.

#### 5.5 Resources required

State total project cost by capital spending, hiring, working capital, and contingency. Reconcile the owner contribution and external financing request with the executive summary and workbook. Explain the timing and milestone enabled by each material use of funds. Create a use-of-funds table only when at least three uses meet the table eligibility rule.

#### 5.6 Implementation roadmap and action plan

Set phases with start dates, end dates, and exit conditions. Identify actions, owners, dependencies, costs, measurable completion tests, and decision gates. State the critical path and external dependencies such as permits, supplier lead times, financing disbursement, and client approval. Create an action table only when at least three actions meet the table eligibility rule.

#### 5.7 Risk assessment and contingencies

Limit the detailed register to the five most material risks. Trace each risk to the analysis that identified it. State category, likelihood, impact, early warning measure, mitigation, contingency trigger, contingency response, owner, and review cadence. Identify the risk that could make the plan unviable and state the pre-agreed response. Create a risk table only when at least three risks meet the table eligibility rule. The quantified risks chosen as scenario drivers must appear here and point to Appendix C.

## Appendices

- `Appendix A. Assumptions and items to confirm`: the assumption register and the open items list, with the same IDs used in the workbook's Source Log.
- `Appendix B. Sources`: page titles, organizations, publication dates, access dates, and URLs for every external source.
- `Appendix C. Scenario analysis`: the base, downside, and upside cases. Open with a short paragraph defining each case's named drivers and why those drivers, then present the outcomes: revenue by projected year, net income by projected year, ending cash or peak cash need, and the financing implication, followed by a paragraph on what the downside means for the financing request and which early-warning measures from section 5.7 would trigger corrective action. Every figure comes verbatim from the scenario extractions; never retype or estimate them. The three-case outcome table meets the table eligibility rule.

Start every appendix on a new page.

## Traceability requirements

Reconcile section 5 with the upstream analysis:

- The executive-summary financing need must equal the total in section 5.5 and the workbook.
- Industry, technology, and regulatory findings must inform the risk assessment in section 5.7.
- The target market must inform the entry sequence in section 5.1.
- Competitor evidence must support the positioning statement in section 5.1.
- Products, services, pricing, and direct costs must support the model rationale in section 5.2.
- Sales channels and promotion must become entry actions in sections 5.1 and 5.6.
- Equipment and technology needs must appear in section 5.5 and the workbook.
- Management and staffing decisions must assign owners in sections 5.3, 5.6, and 5.7.
- The scenario drivers in Appendix C must trace to risks in section 5.7 and to research in section 1.

## Drafting conventions

- Use concise paragraphs and apply the list rules in `references/document-standards.md`.
- Avoid repetition across the executive summary and body.
- Label forecast figures as projections.
- Cite external facts with numbered endnotes or the source appendix.
- Put the business name and production date on the cover and in the filename.
- Update the real TOC field after final pagination.
- Remove every placeholder, drafting prompt, sample instruction, unused table, and unused blank row.

## Narrative and financial consistency

Confirm that the document matches the workbook for forecast dates, currency, sales by stream, gross margin, payroll, capital purchases, financing requested, owner contribution, loan payments, break-even narrative, profit, cash requirement, risks, and the Appendix C scenario figures. Pull every workbook figure with `scripts/extract_workbook_outputs.py`; never quote a number from memory.
