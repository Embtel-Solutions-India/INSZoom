# USCIS Native AcroForm POC Report

**Status as of this writing: PARTIAL EVIDENCE — PDF/AcroForm structure conclusively verified
(strongly positive, cross-validated by two independent libraries); browser-DOM interactivity
(the literal §A question) not yet observed, for lack of a browser-automation tool in this
agent's environment.** See "Decision" at the bottom.

## PDF Identity
- Form: **I-129**, edition **2026-02-27**
- Template `_id`: **6a8e07e164c23fe108954e92**
- Storage key: `government/uscis/I-129/2026-02-27/edc3cd0be3f7b0e92f01d685322aedca311b9004d59d08e93b5de2aa2ef13468/form.pdf`
- SHA-256 (of the raw stored artifact bytes): `60bc276d4748cfc69eb2cd671ec5d28000c50efe376e4daeed5431e0826fef24`
- Byte length: 7,173,579 (larger than the 2.2MB `dev-assets` source PDF — expected:
  `normalizePdf.js` runs qpdf with `--stream-data=uncompress`, which decompresses previously
  compressed streams)
- Magic bytes: `%PDF-`
- XFA marker present: **true** — expected per `normalizePdf.js`'s own doc comment: qpdf does
  not strip XFA; `pdf-lib` drops it only when pdf-lib itself loads/saves the file (confirmed
  independently below — see "pdf-lib cross-check")
- AcroForm marker present: **true**
- react-pdf version: 10.4.1 (confirmed in `INSZoom/frontend/package-lock.json`)
- pdfjs-dist bundled version: **5.4.296**, at `react-pdf/node_modules/pdfjs-dist` (confirmed;
  top-level `pdfjs-dist` is `^6.2.108`, a different major version, correctly excluded)
- Normalization: qpdf, confirmed idempotent/deterministic per `normalizePdf.js`
- Storage/DB: AWS-hosted MongoDB (`immigration_crm` @ `18.210.74.196`, confirmed not Atlas) +
  S3 (`inszoom-bucket`, `us-east-1`) — this was a **fresh, unseeded environment** at the start
  of this POC (zero `USCISFormTemplate` documents); the user ran the project's own idempotent
  `npm run seed:uscis-forms`, which imported and activated all 7 official USCIS PDFs including
  this I-129. Not a PDF/pdfjs finding — an environment-setup gap, now resolved.
- Browser / OS for the actual interactivity test: **not yet exercised** — no browser-automation
  tool is available to this agent (checked via tool search; none registered). See "Decision."
- Test date: 2026-08-26 (structural evidence below is from this date; browser test still open)

## Structural AcroForm evidence (G1, G3-structural, G4-data, G5, G6 — collected without a browser)

Two POC-only diagnostic scripts (`Backend/scripts/poc-i129-acroform-inspect.js` and
`poc-i129-acroform-find-candidates.js`, neither wired into any route) read the REAL stored PDF
bytes via `storageService.readBuffer` (the exact same code path `getTemplatePdf` uses) and
inspected the AcroForm layer two independent ways:

**1. pdfjs-dist 5.4.296 (the exact nested copy react-pdf bundles), run directly in Node via
`page.getAnnotations({intent:'display'})` — no browser, no react-pdf, no worker:**
- 980 total `Widget` subtype annotations across all 38 pages.
- Breakdown: `Tx` (text) 623, `Ch` (choice/dropdown) 24, `Btn` (button) 333.
- `pagesRendered` (pdfjs) = 38 = `declaredPageCount` (DB). `totalWidgetAnnotations` (pdfjs) =
  980 = `declaredFormFieldsCount` (DB). Exact match.

**2. pdf-lib, an entirely separate library, run against the same stored bytes:**
```
PDFTextField: 623
PDFDropdown: 24
PDFCheckBox: 333
PDFRadioGroup: 0
```
This matches pdfjs's breakdown exactly and also matches the independent baseline already
recorded in `docs/forms/ARCHITECTURE.md` from an earlier, unrelated project phase: **"38 pages,
980 AcroForm fields, 349/351 written, 311/311 persisted-value fidelity."** Three independent
measurements (this POC's pdfjs scan, this POC's pdf-lib scan, and the pre-existing
ARCHITECTURE.md baseline) now agree on the same page/field counts.

**What this conclusively rules out:** the single hardest failure mode this POC could hit —
§I.1's "the qpdf normalization stripped the widget annotations, zero AcroForm fields, blocker
that cannot be fixed in the frontend" — did not happen. The AcroForm layer is fully intact,
richly populated, and has real, non-trivial export values (see below). This was previously
only backed by one prior, indirect data point (ARCHITECTURE.md); it is now backed by two fresh,
independent, direct measurements against the actual stored artifact.

**What this does NOT prove:** pdfjs's Node `getAnnotations()` API and its browser
`AnnotationLayer` DOM renderer are different code paths in the same library. Confirming the
structure is sound and rich is necessary but not sufficient to answer §A — only a real browser
answers whether `AnnotationLayer` turns these into interactive elements that fire recoverable
events.

### Field-type findings relevant to §H's seven tests

| # | §H test | Finding |
|---|---------|---------|
| 1 | Text field | 623 `Tx` widgets exist. Example: `form1[0].#subform[0].Line1_FamilyName[0]` (petitioner last name, page 1). |
| 2 | Date-like text field | USCIS date fields are plain `Tx` widgets (confirmed no separate date field type exists in the AcroForm) — covered by the same 623. |
| 3 | Checkbox | 333 `Btn` widgets, ALL `radioButton:false` (i.e. plain checkboxes, not grouped). Confirmed non-boolean export values at the structural level: `Line3_Unit[0]`→`" STE "`, `Line3_Unit[1]`→`" APT "`, `Line3_Unit[2]`→`" FLR "`, `P1Line6_Yes[0]`/`P1Line6_No[0]`→both `"Y"` (each independently Y-when-checked). |
| 4 | Radio group | **Zero radio groups exist in this PDF** (`radioButtonCount: 0` per pdfjs; `PDFRadioGroup: 0` per pdf-lib — two-library agreement). Every "Yes/No" question is a PAIR of independent checkboxes, not one shared-name radio group. **Recommend marking Test 4 N/A for this form**, by the same logic §H.5 already permits for an absent dropdown — this is a fact about the I-129's AcroForm, not a POC failure. |
| 5 | Dropdown | 24 `Ch` widgets confirmed present — NOT N/A. Example: `form1[0].#subform[0].P1_Line3_State[0]` (petitioner mailing-address state), 60 US-state/territory options, 2-letter export values (`AK`…`WY`). |
| 6 | Repeated field | 27 distinct widgets with "family name" semantics found across the form. Strong same-canonical-source example: beneficiary last name appears as `Part3_Line2_FamilyName[0]` (p.2, base form), `Line1_FamilyName[1]` (p.9, E-1/E-2 supp.), `Line1_FamilyName[2]` (p.21, H-1B supp.), `HSupLine2_FamilyName[0]` (p.24, L supp.), `HSupLine2_FamilyName[1]` (p.28, O/P supp.), `HSupLine2_FamilyName[2]` (p.31, Q-1 supp.) — any two are a good Test-6 pair. |
| 7 | Clear a value | No structural blocker — any `Tx` widget works; this is purely a browser-event-payload question (does an emptied input fire `value: ""` vs `undefined`), which needs the live test. |

Raw PDF field names are long, XFA-path-style strings (e.g.
`form1[0].#subform[0].Line1_FamilyName[0]`), not simple flat identifiers — worth keeping in
mind for Phase 1's eventual field-name resolution, regardless of the PASS/FAIL outcome here.

## Configuration Tested
Config A: `renderAnnotationLayer={true} renderForms={true}`
Config B: `renderAnnotationLayer={true} renderForms={false}`

Both are wired side-by-side, sharing one `<Document>`, in
`INSZoom/frontend/src/components/uscis/USCISNativeFormPOC.jsx` (new file; zero production
files modified — `git status --porcelain` shows only new/untracked paths, satisfying G7).

## Annotation Layer DOM Observation
**Not yet collected — this is the crux of what's still outstanding.** The component computes
this automatically on every page render (`domObservation.A` / `.B`, querying
`.annotationLayer input, select, textarea, button` and tallying by `tagName[type]`) and
displays it live. Populating it requires a human to open the page in a real browser.

**What WAS verified without a browser (build/serve correctness, §B.3 "BUILD"):**
- Frontend dev server (Vite, port 3002) and backend API server (port 7000) both confirmed live
  (`GET /poc.html` → 200, `GET /api/health` → 200).
- `GET /poc.html`, `/src/poc/pocMain.jsx`, `/src/poc/PocHarness.jsx`,
  `/src/components/uscis/USCISNativeFormPOC.jsx` all → 200 via Vite's transform pipeline, no
  esbuild syntax/compile error.
- The nested-pdfjs worker `?url` import resolves correctly:
  `/node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url` → 200,
  `Content-Type: text/javascript`, 1,046,214 bytes — the same resolution pattern
  `USCISFormRenderer.jsx` already relies on in production works identically for this new file.

"TEST"/"VERIFY" (§B.4–5) — actually loading the PDF in-browser and interacting with it — do
not yet have data.

## Field Name Extraction Method
**Not yet determined empirically in-browser.** The component implements all of §I.3's
candidate extraction paths in parallel (`target.name`, `target.id`, `data-annotation-id` on
the event target and each ancestor up to 6 levels, plus a live
`pdfDocument.annotationStorage.getAll()` snapshot taken on every captured event) specifically
so this can be answered from real data rather than assumed.

## Test Results

| Test | Field Type | Config | Raw Field Name | Value Captured | Export Value | Status |
|------|-----------|--------|---------------|----------------|--------------|--------|
| 1 | Text (`Line1_FamilyName[0]`) | A | — | — | N/A | **PENDING (browser)** |
| 2 | Date-like text | A | — | — | N/A | **PENDING (browser)** |
| 3 | Checkbox (`Line3_Unit[0..2]`, `P1Line6_Yes/No`) | A | — | — | — | **PENDING (browser)** |
| 4 | Radio group | A | — | — | — | **N/A — recommended** (zero radio groups exist in this PDF; see table above) |
| 5 | Dropdown (`P1_Line3_State[0]`) | A | — | — | N/A | **PENDING (browser)** |
| 6 | Repeated field (beneficiary last name, e.g. p.2 vs p.21) | A | — | — | N/A | **PENDING (browser)** |
| 7 | Clear value | A | — | — | N/A | **PENDING (browser)** |

Per §K/G4, "not attempted" is not acceptable as a final state without justification — Test 4
now has an evidence-backed N/A recommendation; the rest are marked PENDING (work not yet
performed, not attempted-and-failed) rather than any final verdict. The component has manual
PASS/FAIL/N-A controls wired to snapshot the most recent captured event as evidence for exactly
this table; it has not yet been operated in a browser.

## Coordinate Observation (diagnostic only)
Not yet collected — depends on the same browser session as the Test Results above. (Real
widget `rect` values ARE now known from the structural scan, e.g.
`Line3_Unit[0]` → `[424.501, 268.002, 434.501, 278.002]` in PDF points — these can be compared
against the rendered element's `getBoundingClientRect()` once the browser test runs.)

## Failures and Root Causes
No pdfjs/react-pdf/PDF-structure failure has been observed — quite the opposite; the structural
evidence above is unusually strong and fully cross-validated. The one failure encountered was
environmental (empty target database), root-caused to the recent AWS MongoDB migration not yet
being seeded, and resolved by the user running the project's own idempotent seed script.

## Backend Contract Match (G5)
Mechanism confirmed wired (not yet exercised with a live captured event): on mount,
`USCISNativeFormPOC.jsx` fetches the full template document (`GET /uscis-forms/:id`) and builds
a `Set` of all 980 `formFields[].fieldName` values, then flags each captured DOM event's
best-guess extracted field name as `matchesKnownFieldName` against that set in real time. This
stands in for a live `workspace.formFields` (which would additionally require an existing
`CaseForm` instance of I-129 attached to a real case, not required for this POC) —
`template.formFields[].fieldName` is the same raw-PDF-field-name source `workspace.allFields`
is built from, so it is an equivalent ground truth.

## Decision

### Not yet reached — PDF-structure risk is retired; browser-DOM risk remains open

Two things blocked this POC from reaching a PASS/PARTIAL/FAIL verdict, and both are now
understood precisely:

1. **Environment gap (RESOLVED):** the target database had zero I-129 templates. The user ran
   `npm run seed:uscis-forms` themselves (this agent's own attempt was correctly blocked by the
   Claude Code auto-mode permission classifier, since it writes to shared remote
   infrastructure). Re-running the structural scripts afterward produced the strongly positive
   evidence above.

2. **No browser-automation tool available to this agent (STILL OPEN):** §A's actual question —
   do the PDF's own AcroForm widgets become interactive and fire reliable change events in a
   real browser — can only be answered by a human (or a future agent session with browser
   tooling) driving `http://localhost:3002/poc.html`, which is now fully reachable (both
   frontend and backend dev servers confirmed live).

**What is fully built and ready, with the PDF-structure risk now retired:**
- The POC component implementing every requirement in §G/§H/§I, now informed by concrete real
  field candidates for every test (including the evidence-backed Test 4 N/A).
- A zero-production-file-change route to it (`poc.html` / `pocMain.jsx` / `PocHarness.jsx`, a
  second Vite entry point — confirmed live at `http://localhost:3002/poc.html`).
- Two structural diagnostic scripts that jointly retire the single scariest failure mode this
  POC could have hit (no/stripped AcroForm layer) — that risk is gone.

**Recommended next step:** a human logs into the main app at `http://localhost:3002`, opens
`http://localhost:3002/poc.html` in the same browser, and works through the 7 tests using the
on-page controls and the field candidates listed above, then "Copy findings JSON" to hand back
verbatim evidence so this report's Test Results table and final Decision can be completed.

**No architectural decision (native AcroForm editing vs. inline overlay) should be made from
this document yet** — the PDF-structure prerequisite is now very solidly satisfied, but the
literal §A question about browser DOM interactivity still has zero direct evidence either way.
