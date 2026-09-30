# Local document parser

`worker.mjs <input-file> <extension>` reads one Host-owned copied input. It writes
one JSON line using `blocky.document-result/v1`. Errors use
`blocky.document-error/v1` and contain only `schemaVersion` and `code`.
The worker emits no paths, original errors, or library diagnostics.

The API exports `createParser({runtimeRoot})`, `parseBytes(bytes, extension)` and
`parseFile(path, extension)`. The default runtime root is this package's `runtime/`.
Host constructs the runtime root; documents cannot override paths or settings.

## Runtime assets

Keep installed production dependencies and their locked dependency closure with
the package. Keep PDF.js `cmaps/`, `standard_fonts/`, `wasm/` and legacy worker
files in their package layout. Keep all Tesseract core variants in its package
directory. The Windows canvas package requires both its native `.node` binary
and `icudtl.dat`.

Put the locked `4.0.0_best_int` `chi_sim.traineddata.gz` and `eng.traineddata.gz`
under `runtime/langs/`. These assets are separately packaged; their development
packages are not production dependencies. OCR uses local worker/core/language
paths and disables language caching. No font or PDF fixture generator is a
production dependency.

## Parsing and bounds

PDF text is extracted per page. Textless pages containing images are rendered
at scale 2 and OCRed serially. PNG/JPEG/WebP dimensions are inspected before
native decoding. OCR locators use top-left pixel coordinates; PDF OCR regions
refer to the rendered scale-2 page. DOCX paragraphs include a structural table
path. XLSX cells return values or cached formula results without evaluating
formulas. CSV locators use logical row numbers.

Limits: source 32MiB, total segment text 8MiB, 10,000 segments, 64KiB per segment,
200 PDF pages, 16MP per rendered page/image, 50 worksheets, 100,000 nonempty
cells, 64KiB CSV records. Exceeding a bound rejects the document; output is never
silently truncated. The segment limit can reject cell-heavy workbooks before
their cell-count limit.

Office ZIPs are inspected before parsing: actual inflated bytes, 4096 entries,
16MiB per entry, 64MiB total, compression ratio <=100, no duplicates, traversal,
symlinks, encryption, macros/embedded objects, DTD/entity declarations or external
relationships. XML and CSV require UTF-8. No ZIP file is extracted to disk.

Host must still enforce the restricted process, immutable input/runtime snapshot,
memory/deadline/output limits, network denial and whole-process cancellation.
Parser limits do not replace OS containment; binary decoders and Office libraries
may allocate internally before returning their data. The API does not install
assets or manage Host process lifetime.

## Tests

`pnpm --filter @blocky/document-parser test` runs real small public synthetic
format/OCR samples and malformed/limit tests. OCR test assets are copied into
`try/agent-capability-upgrade/document-parser-tests/runtime`, not into this package.
The fixture Chinese PDF embeds a subset of Noto Sans CJK under SIL OFL 1.1;
its license is retained with the test fixtures.
