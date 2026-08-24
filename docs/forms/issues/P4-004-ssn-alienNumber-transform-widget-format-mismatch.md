### [P4-004] §E's proposed ssn/alienNumber USCIS-citation formats would overflow the real I-129 widget constraints - implemented but deliberately not wired
- Date: 2026-08-25
- Area / file(s): `Backend/src/modules/form-mapping/services/MappingResolver.js` (`applyTransform`,
  new `ssn`/`alienNumber` cases - implemented, unit-tested, NOT wired to any real crosswalk edge)
- Category: missing-transform
- Symptom: none observed in production - this is a design-time finding, not a runtime defect.
  The task's own ground truth (§E) specified `ssn → xxx-xx-xxxx` and `alienNumber → A-xxxxxxxxx` as
  the target USCIS formats. Checked against the REAL I-129 widgets' own `validationRules` before
  wiring either transform to a real edge, rather than assuming the citation format was correct for
  every widget.
- Reproduction: `Line5_SSN[0]`'s `validationRules` are `{maxLength: 9, regex:
  "^(\d{3}-?\d{2}-?\d{4})$"}`. A dashed value ("123-45-6789") is 11 characters - it exceeds
  `maxLength: 9` even though the regex's `-?` makes the dashes structurally optional.
  `Line1_AlienNumber[0]`/`Line10_AlienNumber[0]`'s `validationRules` are `{maxLength: 9, regex:
  "^A?\d{7,9}$"}` - a prefixed value ("A-123456789" or even "A123456789") exceeds `maxLength: 9` and
  the regex has no dash character at all. Both crosswalk comments (`MANUAL_ENTRY_FIELDS.
  format_mismatch_confirmed_by_validation` in `i129-h1b-crosswalk.js`) already documented this exact
  overflow, predating this phase, as the reason these 3 fields were left manual: "a new transform
  type to MappingResolver is out of scope... so left manual rather than writing a value that
  overflows/mismatches the widget."
- Root cause: the standard USCIS PRINTED-form citation format for these values (dashed SSN, "A-"
  prefixed alien number) is not what these specific FILLABLE PDF WIDGETS accept - the widgets are
  digits-only boxes (the dash/prefix, where shown at all, is part of the PDF's static printed
  graphics, not something the fillable text field should reproduce).
- Causing action: n/a (a specification mismatch caught during implementation, not a code defect).
- Impact: had the `ssn`/`alienNumber` transforms been wired to `Line5_SSN`/`Line1_AlienNumber`/
  `Line10_AlienNumber` using the exact format §E specified, every value would have failed that
  widget's own validation (and, if written anyway, exceeded its `maxLength` on the actual generated
  PDF).
- Phase-4 handling: characterized-only for these 3 specific fields - the general-purpose `ssn`/
  `alienNumber` transforms ARE implemented in `MappingResolver.applyTransform` and unit-tested (they
  may be useful for a differently-constrained widget on a form Phase 4 doesn't touch, or a future
  display/export context), but were deliberately NOT wired to these 3 fields, which remain
  `MANUAL_ENTRY_FIELDS` exactly as before. The `phone` transform (also new this phase) WAS wired to a
  real edge (`Line2_DaytimePhoneNumber1_Part8[0]`) after confirming its widget's `validationRules`
  (`maxLength: 15`, regex allows digits/+/()/-/space/period) actually accommodate the formatted
  output - verified via a real-pipeline integration test, not just the unit-level transform test.
- Status: open (characterized, not a regression - nothing was broken; an opportunity not yet taken)
- Planned fix phase: whichever phase next revisits `MANUAL_ENTRY_FIELDS.
  format_mismatch_confirmed_by_validation` - the correct fix for these 3 fields is a
  digits-only-normalization transform (strip any existing dashes/prefix, keep exactly the raw
  digits, no re-insertion), which is the OPPOSITE direction of `ssn`/`alienNumber` as currently
  specified (those ADD formatting) - not something to bolt onto the existing transform names without
  a deliberate design decision on naming/behavior.
