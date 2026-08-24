### [P1-000] Original Phase 1 dictionary premise retracted
- Date: 2026-08-20
- Area / file(s): n/a (planning/scope correction, not a code area)
- Category: invariant-risk (scope/process correction)
- Symptom: an initial Phase 1 task briefing assumed the case-manager editor reads a
  "hand-authored" `USCISFormTemplate.formFields.fieldType` that could drift from the real AcroForm
  PDF, and directed building a brand-new "authoritative AcroForm field dictionary"
  (`acroFieldDictionary`) extracted fresh via pdf-lib, persisted on the template, with the renderer
  switched to read it.
- Reproduction: n/a — this is a premise correction, not a reproducible bug.
- Root cause: research (this session, before the corrected task arrived) proved the premise false:
  `PDFFieldScannerService.scan()` already extracts the full AcroForm dictionary (widget kind via
  `pdfFieldType`, semantic type via `semanticType`, geometry, flags, options, appearance) at
  import time, and it is persisted verbatim to `USCISFormTemplate.formFields`
  (`USCISFormImporterService.js:320`) and read verbatim by the renderer's serialization chain
  (`normalizeField`/`buildSections`/`buildFieldView` — see `docs/forms/PHASE1_BASELINE.md`'s
  authority-chain trace). The authoritative dictionary already existed; there was nothing to build.
- Causing action: n/a.
- Impact: building the originally-briefed dictionary would have duplicated `formFields` in a new
  ~980-entry array, directly risking MongoDB's 16MB per-document ceiling — this session
  independently measured the real I-129 template at 15.72MB, only ~290KB of headroom (see
  `PHASE1_BASELINE.md`). A prior, unrelated change to this same model already breached that
  ceiling once (the reason `formFields.labelSource` exists but the raw `/TU` tooltip text does
  not). Proceeding on the false premise would very likely have repeated that exact failure.
- Phase-1 handling: retracted before landing in a commit. Work already built under the false
  premise (`Backend/src/models/USCISAcroFieldDictionary.js`, `AcroFieldDictionaryExtractor.js`,
  `phase1BackfillAcroFieldDictionary.js`, and 4 new pointer fields on `USCISFormTemplate`) was
  fully removed; see `docs/forms/PHASE1_RUN_JOURNAL.md` for the exact revert steps, including an
  accidental write to the real Atlas database (caught, confirmed read-only, and reverted with the
  user's explicit approval before any further work proceeded).
- Status: resolved (corrected)
- Planned fix phase: n/a — Phase 1 was rescoped to prove the authority chain, close the one real
  `semanticType`-serialization gap if present (found: already present, no-op), reconcile
  authoritative `formFields` against crosswalk mappings, and lock in the rich scan output with
  characterization tests. See `PHASE1_BASELINE.md`/`PHASE1_RECONCILIATION.md` for the corrected
  deliverables.
