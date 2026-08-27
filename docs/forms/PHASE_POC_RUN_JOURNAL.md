# USCIS Native AcroForm POC — Run Journal

Chronological log. One entry per loop iteration per §B of the POC task spec.

---

## [T+00:00] PLAN — Pre-work protocol
Re-read every file in §E in full before writing code.

**Files read (full):**
- `INSZoom/frontend/src/components/uscis/USCISFormRenderer.jsx` (lines 1–910; remainder not
  needed for pre-work — the fields referenced by §E are all in this range)
- `INSZoom/frontend/src/services/api.js` (full)
- `Backend/src/modules/uscis-forms/uscis-form.controller.js` (full)
- `Backend/src/utils/normalizePdf.js` (full)
- `Backend/src/modules/uscis-form-import/seeds/i129.seed.js` (partial — header + fillability guard)
- `docs/forms/ARCHITECTURE.md` (XFA/AcroForm/qpdf sections)

**Confirmed against §E claims:**
- `USCISFormRenderer.jsx:363-370` — `<Page renderAnnotationLayer={false} renderTextLayer={false} .../>` — CONFIRMED verbatim.
- `USCISFormRenderer.jsx:3` — `import 'react-pdf/dist/Page/AnnotationLayer.css'` — CONFIRMED.
- `USCISFormRenderer.jsx:10` — nested-pdfjs worker `?url` import — CONFIRMED.
- `USCISFormRenderer.jsx:59` — `pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl` — CONFIRMED.
- `USCISFormRenderer.jsx:577-594` (`saveFieldByName`) — payload `{fieldName, sectionKey, value, reason}` — CONFIRMED.
- `api.js:222` — `templatePdf: (templateId) => api.get(\`/uscis-forms/${templateId}/pdf\`, { responseType: 'blob' })` — CONFIRMED.
- `api.js:231` — `saveWorkspaceField` PATCH route — CONFIRMED.
- `uscis-form.controller.js:206-228` (`getTemplatePdf`) — reads `template.artifacts?.form?.storageKey || template.pdfStorageKey` via `storageService.readBuffer`, sends `application/pdf` inline — CONFIRMED (route mounted at `GET /:id/pdf` in `uscis-form.routes.js:53`).
- `package-lock.json` — `react-pdf@10.4.1` → nested `pdfjs-dist@5.4.296`; top-level `pdfjs-dist@^6.2.108` — CONFIRMED, both version numbers exact.
- `normalizePdf.js` — qpdf invoked with `--object-streams=disable --stream-data=uncompress --decrypt --deterministic-id`; comment confirms "pdf-lib then reads/fills the AcroForm layer (residual XFA is dropped by pdf-lib on save)" — CONFIRMED XFA-strip/AcroForm-preserve behavior.
- `ARCHITECTURE.md` — "Preserve the verified I-129 rendering fidelity (38 pages, 980 AcroForm fields, 349/351 written, 311/311 persisted-value fidelity)" — this is prior, independent evidence that the normalized I-129's AcroForm layer is intact and large, from a pdf-lib-based fidelity check (not pdfjs, not the browser DOM).

**PDF accessible via `uscisFormsApi.templatePdf`:** NO at time of writing — see next entry.

Pre-work complete. Files read: [USCISFormRenderer.jsx, api.js, uscis-form.controller.js,
normalizePdf.js, i129.seed.js, ARCHITECTURE.md]. PDF accessible: NO (no active I-129
template exists yet in the connected database — see next entry).

---

## [T+00:05] ACT — Confirm real PDF availability
Ran a structural-inspection script (`Backend/scripts/poc-i129-acroform-inspect.js`, POC-only,
not wired into any route) that connects to the configured `MONGODB_URI` and queries
`USCISFormTemplate` for an active I-129.

**Result:** `{"error":"No active I-129 template found"}`. Follow-up query
(`USCISFormTemplate.countDocuments({})`) returned **0** — the connected database
(`immigration_crm` on host `18.210.74.196`, an AWS-hosted MongoDB, NOT Atlas) has zero
`USCISFormTemplate` documents of any kind. This is consistent with the recent
"AWS mongodb setup" migration commit (`f7fcb9e`) — the environment was pointed at a fresh
database that has not yet been seeded.

**Diagnosis:** BLOCKER-shaped, but recoverable — the project ships its own idempotent,
non-destructive seed script (`npm run seed:i129`, and the aggregate `npm run seed:uscis-forms`)
specifically for this purpose. Not a structural PDF/pdfjs problem; a pure environment-setup gap.

---

## [T+00:08] Pre-work checklist for the seed/import sub-task
Per the user's follow-up instruction, ran the pre-work checklist before touching the shared
AWS environment:
- `where qpdf` → `C:\Program Files\qpdf 12.3.2\bin\qpdf.exe`; `qpdf --version` → `12.3.2`.
  `Backend/.env`'s `QPDF_PATH` already points at this exact path — no fix needed (the
  operator note assumed it was still a placeholder; it was not).
- `Backend/.env`: `MONGODB_URI` → AWS host (not `mongodb.net`/Atlas) — CONFIRMED via
  `mongoose.connection.host` = `18.210.74.196`.
- `Backend/.env`: `STORAGE_PROVIDER=s3`, `AWS_S3_BUCKET=inszoom-bucket`, `AWS_REGION=us-east-1`,
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` present (values not printed).
- S3 connectivity test (`HeadBucketCommand`) → **succeeded** ("S3 bucket accessible").
- All 7 `Backend/dev-assets/uscis/*.pdf` files present, sizes match the expected ranges
  (I-129 2.2M ... I-907 384K).
- `Backend/node_modules/@aws-sdk/client-s3` present.

All pre-work checks GREEN.

---

## [T+00:10] ACT — Attempt `npm run seed:uscis-forms`
**BLOCKED** by the Claude Code auto-mode permission classifier: this command writes to the
shared remote AWS MongoDB + S3 bucket, which the classifier correctly treats as an action
requiring explicit human authorization rather than agent judgment, even though the seed
scripts are documented as idempotent/non-destructive.

Asked the user how to proceed. **User decision:** they will run `npm run seed:uscis-forms`
(or `npm run seed:i129`) themselves, then notify this session to continue.

**Status at time of writing: PENDING — waiting on the user to run the seed.**

---

## [T+00:12] ACT — Build the POC deliverables (independent of the seed; can proceed in parallel)

Created, all NEW files, zero modifications to any existing file (`git status --porcelain`
confirms only new/untracked paths):

1. `INSZoom/frontend/src/components/uscis/USCISNativeFormPOC.jsx` — the POC component per §G.
   Implements: PDF identity capture (SHA-256, magic bytes, XFA/AcroForm marker scan, pdfjs
   version), independent `page.getAnnotations()` structural scan per test page (so the tester
   can see ground-truth widget names/types/export values before interacting), side-by-side
   Config A (`renderForms=true`) / Config B (`renderForms=false`) rendering sharing one
   `<Document>`, DOM observation of each config's `.annotationLayer` contents, a capture-all
   `input`/`change` listener per config implementing every §I.3 field-name-extraction path in
   parallel (`target.name`, `target.id`, `data-annotation-id` on the target and its ancestors,
   plus a live `pdfDocument.annotationStorage.getAll()` snapshot) so the live table shows which
   extraction path actually works instead of assuming one, a live captured-events table with a
   "matches known field name" flag cross-referenced against the template's own
   `formFields[].fieldName` list (the G5 ground truth), manual PASS/FAIL/N-A controls for each
   of the 7 field-type tests, and a "copy findings JSON" button.
2. `INSZoom/frontend/src/poc/PocHarness.jsx` — auth bootstrap (`POST /auth/refresh` using the
   existing session cookie — assumes the tester is already logged into the main app in the same
   browser) + active-I-129-template lookup (`GET /uscis-forms/registry/active`) + mounts
   `USCISNativeFormPOC`.
3. `INSZoom/frontend/src/poc/pocMain.jsx` — React root mount, referenced only by `poc.html`.
4. `INSZoom/frontend/poc.html` — a second Vite HTML entry point (Vite's dev server serves any
   `.html` file under `root` without any config change — confirmed no `vite.config.js` exists;
   the project uses `scripts/vite-options.mjs` with `root: process.cwd()` and no
   `build.rollupOptions.input` restriction, so an additional root-level HTML file needs zero
   edits to any existing config). This is the "temporary dev-only route" §G calls for, achieved
   with zero production file changes rather than a temporary edit to `App.jsx`/routes that would
   have to be reverted.

**BUILD verification performed (no browser available in this environment — see Diagnose below):**
- Started the frontend dev server (`npm run dev`, port 3002, confirmed via
  `scripts/vite-options.mjs`).
- `GET /poc.html` → `200`.
- `GET /src/poc/pocMain.jsx` (Vite-transformed) → `200`, valid ESM import graph shown in the
  transformed output, no esbuild syntax/compile error.
- `GET /src/poc/PocHarness.jsx` → `200`.
- `GET /src/components/uscis/USCISNativeFormPOC.jsx` → `200`, transformed output shows the
  nested pdfjs worker `?url` import rewritten to
  `/node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url`.
- `GET` that resolved worker URL directly → `200`, `Content-Type: text/javascript`,
  `Content-Length: 1046214` — the exact same nested-pdfjs-worker resolution pattern
  `USCISFormRenderer.jsx` already uses in production resolves correctly for this new file too.
- Backend API server (proxy target `localhost:7000`) was **not running** in this environment,
  so the actual `templatePdf` fetch / `/auth/refresh` calls have not yet been exercised.

**DIAGNOSE (§I applicability):** None of the failure branches in §I.1–§I.5 were triggered —
no crash, no blank annotation layer, no missing field name — because no interactive browser
session has been driven yet. This environment has no browser-automation tool (checked via
`ToolSearch` for Playwright/Puppeteer/devtools-style tools — none available), so DOM
interactivity, live event capture, and the actual G3/G4/G5/G6 gates and the seven field-type
tests (§H) require a human to open `http://localhost:3002/poc.html` in a real browser (logged
into the main app in the same browser first) and interact with the rendered widgets, using the
built-in "Copy findings JSON" / PASS-FAIL-N/A controls in the component itself. This is recorded
transparently in `PHASE_POC_REPORT.md` rather than asserting a result that was not observed.

**Status: component and harness built and confirmed to compile/serve; execution of the actual
browser interactivity test is PENDING (waiting on: (1) the user's seed run, (2) the backend
server running locally, (3) a human driving the browser).**

---

## [T+00:20] User ran `npm run seed:uscis-forms` — all 7 forms seeded successfully

Re-ran `Backend/scripts/poc-i129-acroform-inspect.js` against the now-populated AWS Mongo/S3
environment. Hit one script bug (fixed in-flight, not a POC finding): the nested pdfjs-dist
5.4.296 package has no CJS `legacy/build/pdf.js` — only the ESM `legacy/build/pdf.mjs` — so the
script was switched to `await import('file://...pdf.mjs')` with `disableWorker: true` (Node has
no DOM/worker context; pdfjs's Node-legacy path runs fully in-process instead).

**Full PDF identity (G1 — now complete):**
```
formCode: I-129
editionDate: 2026-02-27T00:00:00.000Z
templateId: 6a8e07e164c23fe108954e92
version: 2026-02-27
status: active
storageKey: government/uscis/I-129/2026-02-27/edc3cd0be3f7b0e92f01d685322aedca311b9004d59d08e93b5de2aa2ef13468/form.pdf
sha256: 60bc276d4748cfc69eb2cd671ec5d28000c50efe376e4daeed5431e0826fef24
byteLength: 7,173,579 (larger than the 2.2MB dev-asset source — expected: normalizePdf.js's
  qpdf step runs --stream-data=uncompress, which decompresses previously-compressed streams)
magicBytes: %PDF-
hasXFAMarker: true (expected per normalizePdf.js's own comment: qpdf does not strip XFA;
  pdf-lib drops it only when IT loads/saves the PDF, e.g. during actual fill/generate - the
  raw stored template artifact this POC reads is upstream of that step)
hasAcroFormMarker: true
pdfjsVersion: 5.4.296
declaredPageCount (DB): 38 — pagesRendered (pdfjs, live): 38 — MATCH
declaredFormFieldsCount (DB): 980 — totalWidgetAnnotations (pdfjs, live): 980 — MATCH
```

**G3-structural (independent of react-pdf/browser DOM) — widget annotation inventory:**
pdfjs's own `page.getAnnotations({intent:'display'})`, called directly in Node (no browser,
no react-pdf, no worker), found exactly 980 `Widget` subtype annotations across all 38 pages —
matching the DB's `formFields.length` and the ARCHITECTURE.md-documented baseline (38 pages,
980 fields) exactly. Breakdown by pdfjs `fieldType`:
- `Tx` (text): 623
- `Ch` (choice/dropdown): 24
- `Btn` (button — checkbox, since see below): 333

**Cross-validated independently via pdf-lib** (a second, unrelated PDF library, run against
the same stored bytes): `PDFTextField: 623, PDFDropdown: 24, PDFCheckBox: 333, PDFRadioGroup: 0`.
Both libraries agree exactly. This is strong, converging, non-browser evidence that:
1. The AcroForm layer is fully intact after qpdf normalization (not stripped, not corrupted).
2. **The I-129 has ZERO true radio-button field groups.** Every "Yes/No" style question
   (e.g. `P1Line6_Yes[0]` / `P1Line6_No[0]`, "nonprofit organized as tax exempt") is implemented
   as a pair of INDEPENDENT checkboxes, not one AcroForm radio group with shared field name.
   **Test 4 ("Radio group") should be marked N/A for this form** — not a POC failure, a fact
   about this PDF's structure, by the same logic §H.5 already allows for an absent dropdown.
3. Dropdowns (`Ch`, 24 of them) DO exist — Test 5 is NOT N/A. Example:
   `form1[0].#subform[0].P1_Line3_State[0]` (petitioner mailing-address state), 60 US-state
   options with 2-letter export values (`AK`, `AL`, ... `WY`).
4. Checkbox export values are confirmed NON-boolean strings at the structural level (not yet
   confirmed in the browser DOM, but this is exactly the §I.4 concern the spec anticipated):
   `Line3_Unit[0]` exportValue `" STE "`, `Line3_Unit[1]` exportValue `" APT "`,
   `Line3_Unit[2]` exportValue `" FLR "`, `P1Line6_Yes[0]`/`P1Line6_No[0]` both exportValue
   `"Y"` (each independently Y-when-checked/Off-when-unchecked, correct for independent
   checkboxes).
5. Raw PDF field names are long XFA-path-style strings (e.g.
   `form1[0].#subform[0].Line1_FamilyName[0]`), not simple flat identifiers — worth keeping in
   mind for however Phase 1's field-name-to-`fieldName` resolution works.
6. **Strong repeated-field (Test 6) candidates found**: "beneficiary last name" appears as a
   semantically-identical field on 6+ different supplement pages, each a distinct AcroForm
   field name: `Part3_Line2_FamilyName[0]` (p.2, base form), `Line1_FamilyName[1]` (p.9, E-1/E-2
   supp.), `Line1_FamilyName[2]` (p.21, H-1B supp.), `HSupLine2_FamilyName[0]` (p.24, L supp.),
   `HSupLine2_FamilyName[1]` (p.28, O/P supp.), `HSupLine2_FamilyName[2]` (p.31, Q-1 supp.) — 27
   total "family name" widgets found across the form. Any two of these are a good Test-6 pair.

**What this DOES and does NOT prove:** this is comprehensive proof the PDF's own AcroForm
structure is sound, complete, and rich with real export values/options — the thing most likely
to hard-BLOCK the POC (§I.1: "if the I-129 has zero AcroForm fields after normalization") is
now conclusively ruled out, twice over, by two independent libraries. It does **not** prove
`react-pdf`'s `AnnotationLayer` renders these as interactive DOM elements, or that they fire
reliable `input`/`change` events with recoverable field names in the browser — pdfjs's Node
`getAnnotations()` API and its browser `AnnotationLayer` renderer are different code paths
inside the same library. That is still the literal §A question, still requires a real browser,
and is still not yet tested here.

Both structural scripts are POC-only, not wired into any route:
`Backend/scripts/poc-i129-acroform-inspect.js`,
`Backend/scripts/poc-i129-acroform-find-candidates.js`.

---

## [T+00:30] Backend + frontend dev servers both confirmed live
- `GET http://localhost:7000/api/health` → `200` (backend running).
- `GET http://localhost:3002/poc.html` → `200` (frontend dev server, started earlier, still up).

**Remaining step to reach a final PASS/PARTIAL/FAIL decision:** a human (this agent has no
browser-automation tool available) needs to log into the main app at `http://localhost:3002`
in a browser, then open `http://localhost:3002/poc.html` in the same browser, and work through
the 7 tests in §H using the on-page controls — informed by the concrete field candidates found
above (Test 4 pre-flagged N/A; Test 5 use `P1_Line3_State[0]`; Test 6 use any two of the
family-name occurrences listed above). "Copy findings JSON" captures verbatim evidence for
`PHASE_POC_REPORT.md`.
