### [P1-001] `PDFFieldScannerService.scan()` return object carries one wall-clock field
- Date: 2026-08-20
- Area / file(s): `Backend/src/modules/uscis-form-import/services/PDFFieldScannerService.js:777`
- Category: nondeterminism
- Symptom: `scan()`'s top-level return object includes `scannedAt: new Date()`. An early version
  of this phase's lock-in determinism test asserted full-object `deepEqual` across two scans of
  the identical PDF bytes and failed solely on `scannedAt` differing by a few milliseconds between
  the two calls.
- Reproduction: `new PDFFieldScannerService().scan(buffer)` called twice on the same buffer;
  compare the two return objects with a full deep-equal.
- Root cause: `scan()` stamps a scan timestamp directly onto its return value
  (`PDFFieldScannerService.js:777`, `scannedAt: new Date()`).
- Causing action: not investigated via `git blame`/`git log -S` — a deliberate, intentional
  timestamp field (there is no evidence this was accidental), not a regression.
- Impact: none on correctness — confirmed `fieldFingerprint` and every other returned structure
  (`fields`, `layout`, `structure`, `sections`, `validation`, `indexes`, etc.) are derived purely
  from `fields`, which is itself fully deterministic; only the one top-level `scannedAt` key
  varies. Not persisted as part of `formFields` (only `scanResult.fields` is assigned to
  `formFields` at `USCISFormImporterService.js:320`), so this has no downstream effect on
  reconciliation, rendering, or fill output.
- Phase-1 handling: characterized-only. `Backend/src/modules/uscis-form-import/tests/phase1.scan-lockin.test.js`'s
  determinism tests explicitly exclude `scannedAt` before comparing (a `withoutScannedAt()`
  helper), documented inline with this exact reasoning, rather than treating it as a defect to
  chase or a reason to weaken the determinism assertion's scope.
- Status: resolved (characterized; no fix needed — expected behavior)
- Planned fix phase: n/a — not a defect.
