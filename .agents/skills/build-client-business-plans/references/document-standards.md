# Word Document Standards

These standards are mandatory for every Word deliverable produced by this skill. Read them in full before creating or editing a Word file. Apply them to the business plan and to any intake document delivered to the user. The Excel workbook is outside this reference and must retain its existing layout, formatting, colours, formulas, validations, named ranges, and logic.

## 1. Black-and-white presentation

- Use black or automatic text only. Do not use coloured headings, titles, captions, bullets, numbers, or list markers.
- Do not use cell shading, paragraph shading, highlighting, background fills, gradients, or watermarks.
- Do not use coloured borders, rules, dividers, accent bars, or side bars. Use black borders where a border is necessary.
- Show hyperlinks as black text. Underline a hyperlink only when the link must be visibly distinguishable.
- Do not use theme colours, accent palettes, brand-colour variables, decorative graphics, icons, or visual ornaments.
- Use a greyscale image or chart only when it is necessary to communicate material information that prose or a plain table cannot communicate adequately.
- Remove colour properties rather than redefining old brand colours as black. This prevents inherited or theme-based colours from returning.

## 2. Plain tables

- Use a table only when at least three items are compared across at least two attributes. Put one or two data points in prose.
- Use single 0.5 point black borders on all outside and inside edges. Apply the same border treatment to every table.
- Do not use row banding, column banding, shaded headers, coloured borders, decorative table styles, or background fills.
- Put bold black text in the header row with no fill. Mark the header row to repeat when the table continues onto another page.
- Left-align text. Right-align numbers and use consistent decimal places and thousands separators. State units in the column heading rather than repeating them in every cell.
- Do not merge cells unless the data structure genuinely requires a merge. Do not include blank filler rows.
- Put a caption directly above every table in the form `Table 1. Short descriptive title`.
- Refer to every table by number in the body text at least once.

## 3. Document architecture

Build the document in this order:

1. Cover page.
2. Document control, when useful.
3. Table of contents.
4. Body.
5. Appendices.

### Cover page

The cover must contain the document title, subtitle, client or organization name, document reference, version, production date, prepared-by field, prepared-for field, and confidentiality marking. Use text only and align it consistently. Put no header, footer, or visible page number on the cover. Start a new section after the cover.

### Document control

A document-control table is optional but preferred when it records at least three versions or changes. Use the same plain-table standard. Include version, date, author, change description, and status. When fewer than three records exist, put the current version and date on the cover instead of creating a table.

### Table of contents

Use a real updateable Word TOC field generated from the built-in heading styles. Do not type the contents manually. Refresh the field after final pagination.

### Body and appendices

Use decimal headings in the body. Letter appendices as `Appendix A`, `Appendix B`, and so on. Start every appendix on a new page.

### Page setup

- Use A4 paper and 2.54 centimetre margins on all sides.
- Use one typeface throughout. Use 11 point body text, 1.15 line spacing, 6 points after each paragraph, no first-line indent, and no empty paragraphs for visual spacing.
- Use the body typeface for headings. Distinguish headings by size and weight only.
- Put the document title at the left of the header and the business or client name at the right. Use small type and no decorative rule.
- Put the confidentiality marking and `Page X of Y` in the footer on every page after the cover.

### Headings

- Use decimal headings such as `1.`, `1.1`, and `1.1.1`. Do not use more than three levels.
- Use Word's built-in `Heading 1`, `Heading 2`, and `Heading 3` styles so the TOC and navigation pane work.
- Use short noun phrases in sentence case. Do not use questions, verb phrases, or colons that split a slogan-like heading.
- Put explanatory prose between a parent heading and its first child heading.
- Do not put a list immediately after a heading.
- Merge a section into its parent when it cannot support at least two substantive paragraphs.

## 4. Prose, bullets, and numbering

Use prose by default. Lists are exceptions for information that is genuinely list-shaped.

Use a bulleted list only when all of these conditions are met:

- The list contains at least three items.
- The items are parallel and have no inherent order.
- Each item fits within two lines.

Use a numbered list only for a sequence, ranking, or set of items that must be cross-referenced later.

Apply these rules to every list:

- Introduce the list with a complete stem sentence ending in a colon.
- Make all items grammatically parallel. Use all fragments or all sentences and begin them with the same part of speech.
- Use sentence case. Give fragments no full stop and complete sentences a full stop.
- Use no more than one level of nesting.
- Do not place two lists back to back. Put analytical prose between them or combine them.
- Convert a list to prose when an item requires three or more sentences.

Do not use a list under every heading, a list with one or two items, bullets that replace connective reasoning, or a takeaways box that repeats the section.

## 5. Language

### Punctuation

Do not use an em dash (`—`) anywhere in the document. Do not substitute an en dash for an em dash. Use a comma, colon, full stop, or brackets. Use an en dash only in numeric ranges such as `2024–2026` and page ranges.

### Banned constructions

Do not use these throat-clearing openers:

- `In today's fast-paced business environment`
- `It's worth noting that`
- `In an era of`
- `As organizations increasingly`
- `As organisations increasingly`

Do not stack filler connectives such as `Furthermore`, `Moreover`, and `Additionally` in consecutive paragraphs. Do not use `Overall` or `In conclusion` unless the section is an actual conclusion.

Avoid consultant-brochure vocabulary when a direct word is available. Scan for these expressions and rewrite every unsupported or unnecessary use:

- `delve`
- `leverage` used as a verb when `use` is accurate
- `robust`
- `seamless`
- `holistic`
- `landscape`
- `ecosystem`
- `unlock`
- `harness`
- `navigate the complexities`
- `drive value`
- `at the end of the day`
- `journey`
- `best-in-class`
- `game-changing`
- `transformative`
- `key` used as an unsupported adjective

Do not use unsupported three-part claims, rhetorical questions as section openers, the heading restated as the first sentence, stacked hedges such as `may potentially` or `could possibly help to`, or sentences that describe the document instead of presenting information. Remove phrases such as `This section will explore` and `The following outlines`.

### Positive requirements

- Use active voice and name the actor.
- Keep one idea in each paragraph. Aim for three to six sentences per paragraph and an average sentence length below 25 words.
- Use concrete, specific information. Give figures with a source and date. Name systems and roles when known.
- State that a number is unavailable when it is unavailable. Do not invent a number to make the document appear complete.
- Use bold only for defined terms and table headers. Do not scatter bold text through sentences for emphasis.
- Do not use italics for emphasis. Use underline only for hyperlinks. Use capital letters only for established acronyms.
- Do not use emoji, icons, arrows, or decorative symbols.
- Use one spelling convention consistently throughout the document.

## 6. Mandatory self-check

After generating and rendering the document, run `scripts/check_word_document.py`. Fix every failure, regenerate or resave the file, render it again, and rerun the check. Do not deliver a file that fails.

The final check must confirm:

- No coloured runs, shading, fills, highlights, coloured borders, decorative graphics, or theme accents.
- No em dash characters.
- A complete cover with no header, footer, or visible page number.
- An updateable TOC generated from heading styles.
- Built-in, decimally numbered `Heading 1`, `Heading 2`, and `Heading 3` styles only, with lettered appendix exceptions.
- No heading immediately followed by another heading or a list.
- No list with fewer than three items, no list without a stem sentence, and no adjacent lists.
- Every table is numbered, captioned, referred to in the text, plain-bordered, and equipped with a bold repeating header row.
- The footer shows `Page X of Y` and the confidentiality marking on every page after the cover.
- No banned word, expression, opener, drafting prompt, or placeholder remains.
- A4 paper, 2.54 centimetre margins, one typeface, and the required paragraph spacing.

At handoff, report a short pass or fail list and identify every banned-language hit with its paragraph or table location. Report the approved template styles used in the final file and the approved styles that were not needed.
