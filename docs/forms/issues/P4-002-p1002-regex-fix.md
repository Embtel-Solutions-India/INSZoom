### [P4-002] P1-002 fixed: `inferTextSemanticType` no longer mismatches place-of-birth fields as dates
- Date: 2026-08-25
- Area / file(s): `Backend/src/modules/uscis-form-import/services/PDFFieldScannerService.js:80-94`
  (`inferTextSemanticType`)
- Category: regex-bug
- Symptom: 13 confirmed field names (5 H-1B/L-1A, 4 K-1, 4 K-3 - all quoted in
  `docs/forms/issues/P1-002-semantictype-inference-false-positives.md`) classified as
  `semanticType: "date"` despite being place names (`CountryOfBirth`, `CityTownOfBirth`,
  `ProvinceOrStateOfBirth`) or unrelated fields matching a bare substring (`Line_CityTown`,
  `PassportorTravDoc`, both contain the bare substring "to").
- Reproduction: `inferTextSemanticType("form1[0].#subform[2].Part3Line4_CountryOfBirth[0]")`
  returned `"date"` before the fix.
- Root cause: the old regex `/date|dob|birth|expiry|expires|issued|from|to/` had two independent
  defects: (1) bare `to`/`from` matched as unanchored substrings inside unrelated words
  ("ci-ty-TO-wn", "passpor-TO-rtravdoc"); (2) `birth` alone matched every birth-related field, not
  only date-of-birth.
- Causing action: not investigated via `git blame`/`git log -S` this session (pre-existing, per
  Phase 1's own characterization).
- Impact: `semanticType==="date"` was untrustworthy for any birth-place-shaped or "to"/"from"-
  containing field name. Downstream, this meant these fields carried a misleading semantic hint that
  a future mapping/UI decision could have acted on. Confirmed to NOT have caused actual date-format
  corruption of these fields' real values, since none of the 13 were wired to a `{transform:{type:
  "date"}}` crosswalk edge in the first place (Phase 1's own finding).
- Phase-4 handling: fixed-in-phase. Removed `birth`/`to`/`from` from the regex entirely rather than
  adding exceptions for each false-positive pattern - every confirmed true date-of-birth field name
  in this codebase (`DateofBirth`, `DateOfBirth`) already contains "date" and is still caught by that
  term alone; `birth`/`to`/`from` were never actually load-bearing for a real date field, only a
  source of false positives. Verified against all 13 confirmed false positives (now correctly
  non-"date") and 7 confirmed true date fields including 3 real date-of-birth field names (now still
  correctly "date") in a new test file,
  `PDFFieldScannerService.inferTextSemanticType.test.js`. `inferTextSemanticType` was exposed via a
  test-only export (`module.exports.inferTextSemanticType`) since it was previously a private,
  module-scoped function.
- Status: resolved
- Planned fix phase: n/a (fixed here). Does NOT retroactively fix already-scanned template
  `formFields[].semanticType` values in the DB - those were set at import time and are unaffected by
  this fix unless the templates are re-imported (explicitly out of scope, per the original P1-002
  ledger entry).
