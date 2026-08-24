### [P1-LOG-001] "Invalid object ref … Trying to parse invalid object" log flood during import
- Date: 2026-08-20
- Area / file(s): `Backend/src/modules/uscis-form-import/services/{FormValidationService.js,FormMetadataService.js,PDFFieldScannerService.js}`, `USCISFormImporterService.js` (the orchestrator that calls all three)
- Category: tooling/setup (log noise / redundant work, not a correctness defect)
- Symptom: per the corrected Phase 1 task's own problem description, the same PDF object-number
  blocks produce repeated "Invalid object ref … Trying to parse invalid object" warnings roughly
  3x per form during one import operation. Not independently re-captured via a live log this
  session (no fresh import was run) — the following root cause was confirmed via static
  source-tracing, which fully explains the "~3x" multiplier without needing a live repro.
- Reproduction: run any of the `npm run seed:i129`-style seed scripts (or `import:form`) against a
  government PDF and capture stdout/stderr — pdf-lib logs recoverable parse warnings directly to
  the console (not through this app's own logger) whenever it encounters an object it has to
  recover from, and it does this independently on every separate `PDFDocument.load()` call.
- Root cause: **confirmed by direct source read** — three separate services each call
  `PDFDocument.load(buffer, ...)` independently on what should be the same normalized buffer
  during one `USCISFormImporterService.importFromBuffer()` call:
  `FormValidationService.js:23`, `FormMetadataService.js:103`, `PDFFieldScannerService.js:519`.
  Each `PDFDocument.load()` re-parses the PDF from scratch and pdf-lib emits its own recoverable-
  object-ref warnings per parse — three independent parses of the same bytes produces exactly the
  "~3x per form" repetition described. No caching/memoization of the parsed `PDFDocument` exists
  across these three calls within one import operation.
- Causing action: not investigated via `git blame`/`git log -S` this session (would require
  picking a specific commit range for three separate files across possibly-different authorship;
  out of scope for a record-only ticket).
- Impact: log noise only in the cases traced this session — does not affect fill/mapping/generate
  output (confirmed: none of the three services in the trace are on the fill path;
  `PDFFieldScannerService`'s output is what's persisted to `formFields`, `FormMetadataService`'s
  and `FormValidationService`'s outputs are import-time metadata/validation results only). Real
  cost is wasted parse work (importing a ~980-field PDF 3x instead of once) and noisy logs that
  could mask a genuinely-actionable warning during import review.
- Phase-1 handling: characterized-only, NOT fixed — extraction/import code is out of Phase 1's
  scope (Phase 1 proves the authority chain and reports mismatches; it does not touch the scanner
  or its sibling import-time services).
- Status: open
- Planned fix phase: whichever phase next touches the import pipeline. Fix approach: parse the
  buffer once (`PDFDocument.load()`) in `USCISFormImporterService.importFromBuffer()` and pass the
  already-parsed `PDFDocument` into `FormValidationService`/`FormMetadataService`/
  `PDFFieldScannerService` instead of each independently loading the same buffer; separately,
  consider routing pdf-lib's console warnings through this app's own logger at `debug` level
  instead of letting them print unconditionally, so a genuinely actionable warning isn't lost in
  routine recoverable-parse noise.
