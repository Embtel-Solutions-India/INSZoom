# Phase 1 Run Journal — Authoritative Field Data: Prove & Lock, Reconcile

Chronological, append-only log of the corrected Phase 1 loop. Phase 1 does **not** build a new
AcroForm dictionary — research proved `PDFFieldScannerService.scan()` already produces one and it
is persisted verbatim to `USCISFormTemplate.formFields`. See `docs/forms/PHASE1_BASELINE.md` for
the authority-chain proof and `docs/forms/PHASE1_RECONCILIATION.md` for the mismatch report.

## 2026-08-20 — Retraction and cleanup

An earlier attempt at Phase 1 (this session, before the corrected task arrived) built exactly what
this phase now forbids: a new `USCISAcroFieldDictionary` model/collection, an
`AcroFieldDictionaryExtractor.js`, a backfill script, and 4 new pointer fields on
`USCISFormTemplate`. That work is retracted per the corrected task's explicit premise (the
dictionary already exists) and its explicit prohibition (no new per-field array, 16MB ceiling
risk). Removed before any of it landed in a commit:
- `Backend/src/models/USCISAcroFieldDictionary.js` (deleted)
- `Backend/src/modules/uscis-form-import/services/AcroFieldDictionaryExtractor.js` (deleted)
- `Backend/src/modules/uscis-form-import/tests/AcroFieldDictionaryExtractor.test.js` (deleted)
- `Backend/src/scripts/phase1BackfillAcroFieldDictionary.js` (deleted)
- `Backend/src/models/USCISFormTemplate.js` — reverted (`git checkout --`) to drop the 4 pointer
  fields (`acroFieldDictionaryId`/`Version`/`ExtractedAt`/`Checksum`) added by the retracted work.

**Also reverted: an accidental write to the real Atlas database.** While testing the (now-deleted)
backfill script, a `require("dotenv").config()` call inside it populated `process.env.MONGODB_URI`
from `.env` (the Atlas connection string), and the script's fallback priority
(`MONGODB_URI || MONGODB_TEST_URI`) picked that over the intended local test DB. Two runs wrote 15
new documents to a new `uscisacrofielddictionaries` collection on Atlas and set 4 pointer fields on
15 `USCISFormTemplate` documents there. Confirmed read-only, then reverted with the user's explicit
go-ahead: deleted all 15 dictionary documents by exact `_id` and `$unset` the 4 fields on all 15
templates by exact `_id`; verified zero remaining afterward. Since the whole approach is deleted
anyway, no residual code risk remains, but the lesson is recorded because it's a real, repeatable
trap: **any script intending to target a test database must put the test-URI env var BEFORE a
dotenv-loaded default in its priority chain**, never after - `dotenv.config()` unconditionally
populates `process.env.MONGODB_URI` from `.env` whenever the shell hasn't already set it.
`Backend/src/test-utils/db.js` avoids this correctly by using a dedicated `MONGODB_TEST_URI` env
var with its own default, never chained after `MONGODB_URI`.

`npm run phase0:verify` reconfirmed green after the revert (H-1B/L-1A/K-3 PASS, 25/25 invariants).

## 2026-08-20 — §F.0 Serialization probe (mandatory scope checkpoint)

Traced the exact backend path from `USCISFormTemplate.formFields[]` to the JSON body of both
`GET .../case/:caseId/:formId/workspace` and `GET .../case/:caseId/:formId/render`:
`uscis-form.service.js`'s `normalizeField` (565-589) and `buildSections` (602-632), and
`interactive-form-review.service.js`'s `buildFieldView` (268-291) for the workspace-specific
second pass. **Every one of these spreads the full raw field object (`{ ...field, ... }`) before
layering its own additions**, and none of those additions collide with `semanticType` or
`pdfFieldType` (confirmed by reading `USCISFormTemplate.js:103-177`'s schema against each
function's explicit override-key list). The one narrowed structure in the whole chain,
`template.fieldIndex` (`uscis-form.service.js:805-815`), is a separate lightweight lookup map, not
the `sections[].fields[]` array `USCISFormRenderer.jsx` actually iterates over.

**Scope confirmation:**
1. The authoritative AcroForm dictionary already exists — it is `USCISFormTemplate.formFields[]`,
   populated by `PDFFieldScannerService.scan()` at import time.
2. Not building a new dictionary/array. `acroFieldDictionary` and the retracted approach above stay
   deleted.
3. `semanticType` **is present** in the edit/workspace payload today — confirmed by tracing every
   serialization step; no property-allowlist step drops it.
4. Proceeding with: reconciliation report (P1.3) + lock-in characterization tests (P1.1) only.
   **No pass-through code change (P1.2) is needed** — recorded as a no-op with the trace above as
   evidence, per §I.2's explicit "if already present → no code" instruction.
5. `npm run phase0:verify` and the full existing suite remain the fill-output-invariance gate;
   nothing in this phase touches mapping/fill/generate files.

## 2026-08-20 — F.1 baseline re-confirmation

`npm run phase0:verify`: PASS/PASS/PASS (H-1B 376/980, L-1A 361/980, K-3 147/450 mapped fields),
25/25 invariants + crosswalk coverage. Re-verified the §E line numbers against the current
checked-out source (see the serialization-probe agent's citations above) — all held; no drift to
record.

## 2026-08-20 — P1.1: lock-in characterization tests (gate G6)

Added `Backend/src/modules/uscis-form-import/tests/phase1.scan-lockin.test.js` (8 tests, 11
assertions) covering semanticType inference, pdfFieldType-vs-semanticType distinction, geometry
(coordinates/boundingBox/coordinateSystem/per-widget widgets[], including a radio group whose two
options resolve to two different pages), flags (pdfFlags raw int, Required bit, classified
textFieldFlags/choiceFieldFlags/radioFieldFlags with correct `{}` for non-applicable widget
kinds), options triples, and determinism (fixture PDF + the real seeded I-129 template's actual
stored PDF, 980 fields).

Found two real things while building this, both characterized not fixed:
- `scan()`'s `scannedAt: new Date()` broke a naive full-object determinism assertion - not a
  defect (confirmed everything else is derived from `fields`, which is deterministic); fixed the
  TEST to exclude it via a `withoutScannedAt()` helper, documented inline. Ledger: P1-001.
- My own fixture-PDF geometry assertion was too strict (expected exact width=100, pdf-lib's
  `createTextField().addToPage()` actually produced 101 - a pdf-lib fixture-creation quirk, not a
  scanner bug); relaxed to a tolerance and derived boundingBox expectations from the actual
  x/y/width/height rather than hardcoding independent numbers.

All 8 tests pass, including the real-I-129 determinism proof (two scans of the same 980-field
stored PDF, byte-identical apart from `scannedAt`) and the persistence-fidelity check (the
PERSISTED `formFields`, not just the in-memory scan result, still carries pageNumber/coordinates/
pdfFlags/semanticType/options for a real field).

## 2026-08-20 — P1.3: reconciliation report (gate G5)

Built `Backend/src/modules/form-mapping/tests/phase1/reconciliationAnalyzer.js` (pure, read-only)
and `Backend/src/scripts/phase1Reconcile.js` (loads real templates, runs the analyzer, writes
`docs/forms/PHASE1_RECONCILIATION.md`). Three classes per the task spec: unmapped-required-field,
dangling-mapping, semantic-type-mismatch.

Results: 0 unmapped-required-field and 0 dangling-mapping across all three forms (H-1B/L-1A,
K-1, K-3). The 0 dangling-mapping result for I-130 is itself a finding - see
`PHASE1_BASELINE.md` §5: it rules out a naming-drift hypothesis for P0-CD-001 and independently
confirms Phase 0's own conclusion (the break is in FormMappingService/MappingResolver's
resolution layer, not a template/crosswalk naming mismatch). 13 semantic-type-mismatch findings
(5+4+4), all the same subclass and all traced to one root cause in the scanner's semantic
inference (`PDFFieldScannerService.inferTextSemanticType`'s regex over-matching "birth" for
place-of-birth fields and bare-matching "to"/"from" substrings) - added a root-cause explanation
directly into the generated report rather than letting 13 rows read as 13 independent defects,
and filed P1-002 in the ledger. Zero checkbox-widget-without-boolean-transform findings across
all three crosswalks - that dimension is clean.

## 2026-08-20 — P1.4: extend the verify gate (gate G3, G6)

Added `npm run phase1:verify` (`Backend/src/scripts/phase1Verify.js`): runs the lock-in tests,
regenerates the reconciliation report, checks the no-new-array/doc-size guard (asserts no
`acroFieldDictionary`-shaped schema path exists and the I-129 template document hasn't grown
beyond a 512KB tolerance over this session's measured 15.72MB baseline, and stays under the 16MB
hard limit), then re-runs `npm run phase0:verify` for fill-output invariance. All green:
```
Lock-in tests: PASS (11 pass / 0 fail)
Reconciliation report: PASS (docs/forms/PHASE1_RECONCILIATION.md regenerated)
No-new-array / doc-size guard: PASS (I-129 template: 15.72MB, baseline 15.72MB, hard limit 16MB)
phase0:verify (fill-output invariance): PASS
 PASS h1b 376/980 mapped, PASS l1a 361/980 mapped, PASS k3 147/450 mapped
 Invariants + crosswalk coverage: PASS (25 pass / 0 fail)
Overall: PASS
```

## 2026-08-20 — P1.5: out-of-scope tickets filed (record only, not fixed)

Filed `docs/forms/issues/P1-LOG-001-invalid-object-ref-flood.md` and `P1-LOG-002-sort-memory-limit.md`
and `P1-CLEANUP-001-triple-field-array-duplication.md`, using the Phase-0 ledger template. For the
two log-bug tickets, went beyond restating the task's own description: confirmed the likely root
cause via direct source read rather than leaving it as an unverified hypothesis -
`FormValidationService.js:23`, `FormMetadataService.js:103`, and `PDFFieldScannerService.js:519`
each independently call `PDFDocument.load()` on the same buffer during one import (explains the
"~3x" repetition), and `USCISScannerService.js:584` sorts un-projected `USCISFormTemplate` docs
(now confirmed ~15.72MB each) with no covering index (explains the 32MB sort-memory overflow).
Neither was independently re-triggered via a fresh live log capture this session - noted
explicitly in each ticket as evidence provenance, not claimed as freshly reproduced.

## 2026-08-20 — Final gate check (G1-G8)

- **G1**: full suite baseline re-confirmed at session start (39 pre-existing failures, same
  classes as Phase 0's final check); no code added this phase touches any file in that failure
  set (all Phase 1 files are new test/report/script files plus zero net production-file changes,
  since the retracted model/extractor/backfill work was fully removed).
- **G2**: `npm run phase0:verify` re-run at the end of `phase1:verify` - PASS (H-1B/L-1A/K-3 byte-
  identical, 25/25 invariants).
- **G3**: no `acroFieldDictionary`/new per-field array exists (confirmed removed); I-129 template
  document measured at 15.72MB, guarded against growth beyond a 512KB tolerance, hard-checked
  against the 16MB ceiling - `phase1:verify`'s guard is green.
- **G4**: §F.0 serialization probe completed and recorded; `semanticType`/`pdfFieldType` already
  present in the workspace/render payload; P1.2 is a documented no-op, zero code added.
- **G5**: `PHASE1_RECONCILIATION.md` generated (three classes, all three forms); P0-CD-001
  cross-referenced (and its naming-drift hypothesis disproven); ledger entries added; zero
  mutation of any `formFields`/crosswalk config.
- **G6**: 8 lock-in tests / 11 assertions pass, covering geometry/pdfFlags/flag-objects/
  semanticType/options/determinism (fixture + real template).
- **G7**: `git diff --name-only` (see below) touches only new test/report/script/doc files plus
  two npm-script-only additions to `package.json` - no fill/mapping/schema-array change.
- **G8**: run journal, baseline, reconciliation, P1-000 correction note, and the three
  out-of-scope tickets (P1-LOG-001/002, P1-CLEANUP-001) all written and cross-linked.

**Status: all gates G1-G8 green.**
