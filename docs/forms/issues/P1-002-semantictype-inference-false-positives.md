### [P1-002] `inferTextSemanticType()` over-matches "date" for birth-place (not birth-date) fields and via bare substring matches
- Date: 2026-08-20
- Area / file(s): `Backend/src/modules/uscis-form-import/services/PDFFieldScannerService.js:80-93`
  (`inferTextSemanticType`)
- Category: type-mismatch
- Symptom: the Phase 1 reconciliation report (`docs/forms/PHASE1_RECONCILIATION.md`) flagged 13
  `date-field-without-date-transform` candidates across all three crosswalks (H-1B/L-1A: 5,
  K-1: 4, K-3: 4). Inspecting the actual field names shows they are almost entirely place-of-birth
  fields (`CountryOfBirth`, `CityTownOfBirth`, `ProvinceOrStateOfBirth`) and two clearly
  unrelated fields (`Line_CityTown`, `PassportorTravDoc`) — none of these are date fields.
- Reproduction: `inferTextSemanticType("Part3Line4_CountryOfBirth")` → `"date"` (wrong; this is a
  place name). `inferTextSemanticType("Line_CityTown")` → `"date"` (wrong; matches the bare
  substring "to" inside "ci**ty**T**o**wn", not any real date-related word).
- Root cause: the regex `/date|dob|birth|expiry|expires|issued|from|to|.../ ` (line 84) has two
  independent defects: (1) `birth` matches ANY birth-related field, not only date-of-birth —
  `CountryOfBirth`/`CityTownOfBirth`/`ProvinceOrStateOfBirth` are place names, semantically
  unrelated to a date value; (2) `from`/`to` have no word-boundary anchoring, so they match as
  bare substrings inside unrelated words (`ci-ty-to-wn`, `passpor-to-r`).
- Causing action: not investigated via `git blame`/`git log -S` this session.
- Impact: `semanticType==="date"` cannot be trusted at face value for any field whose name
  contains "birth" (place-of-birth fields), or coincidentally contains "to"/"from" as a substring.
  This directly affects Phase 2, whose stated plan is to use `formFields.semanticType` for
  semantic enforcement (the "DOB-in-text/text-in-number" class) — reusing this value unconditionally
  for country/city/province-of-birth-shaped field names would produce false "should be a date"
  flags. Does not affect Phase 1's own findings, which explicitly call this out as a caveat rather
  than asserting these 13 as confirmed defects (see the reconciliation report's root-cause note).
- Phase-1 handling: characterized-only, NOT fixed — `PDFFieldScannerService.js` is extraction
  code, explicitly out of Phase 1's scope (Phase 1 proves the authority chain and reports
  mismatches against it; it does not modify the scanner).
- Status: open
- Planned fix phase: Phase 2 (the phase that consumes `semanticType` for enforcement) should
  either fix `inferTextSemanticType`'s regex directly (add word-boundary anchoring; special-case
  "birth" to require an adjacent "date"/"dob"-like qualifier, or exclude "country"/"city"/"place"/
  "province"/"state" + "of birth" combinations) or maintain its own denylist of field-name
  patterns to exclude before trusting `semanticType==="date"`. Either approach is a real code
  change and therefore belongs to whichever phase actually enforces semantics, not this one.
