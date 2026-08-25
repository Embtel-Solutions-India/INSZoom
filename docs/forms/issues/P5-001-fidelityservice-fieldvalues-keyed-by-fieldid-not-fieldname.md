### [P5-001] §G's fidelity-verifier spec assumed caseForm.fieldValues is keyed by PDF field NAME - it's actually keyed by fieldId
- Date: 2026-08-25
- Area / file(s): `Backend/src/modules/form-generation/services/PDFFidelityService.js` (`sampleFieldNames`)
- Category: fidelity-verifier
- Symptom: caught before shipping, via a real-seeded-case integration test
  (`PDFRenderer.renderFiling.test.js`), not in production. A first implementation of
  `sampleFieldNames` iterated `Object.keys(caseForm.fieldValues)` and looked each key up directly in
  `template.formFields` by `fieldName`. Against a real H-1B `AutoFillService.generate()` result (376
  mapped fields), this produced `sampledFields: 0` every time - the field-level check would have
  silently verified NOTHING on every real filing-copy render, while still reporting `valid: true`.
- Reproduction: `PDFRenderer.renderFiling.test.js`'s first test asserted
  `result.fidelityReport.sampledFields > 0` against a real seeded case; it failed with `0 !== true`
  before the fix, immediately surfacing the gap.
- Root cause: `AutoFillService.js`'s own header comment (confirmed by reading it directly, not
  assumed) states plainly: "fieldValues/sourceAttribution/manualOverrides are FLAT maps keyed by the
  exact fieldId string... fieldId is very often a raw AcroForm name... but is a distinct namespace
  from fieldName." §G's own pseudocode (`caseForm.fieldValues[fieldName]`) treated the two as
  interchangeable. For the majority of scanned USCIS AcroForm fields `fieldId === fieldName` as
  strings, which is exactly why a spec-literal implementation didn't obviously look wrong on
  inspection - it only failed once exercised against real mapped data end-to-end, because
  `template.formFields[]` entries were being looked up via `Object.keys(fieldValues)` (fieldId
  strings) treated as fieldName strings, and iteration order/set membership silently produced zero
  matches for this particular real template rather than throwing.
- Causing action: this session's own first-draft implementation of §G's spec, not a pre-existing
  code defect.
- Impact: had this shipped unfixed, `PDFFidelityService.verify`'s field-LEVEL checks (the part that
  actually proves "the embedded PDF value matches what was saved") would never have run in
  production - only the structural checks (page count, overall field count) would have provided any
  protection. `PDFFidelityService.test.js`'s Test 3 (the field-mismatch-caught proof) used a
  synthetic template/caseForm pair with `fieldId` absent (falling back to `fieldName`), so it would
  have kept passing even with the broken version - a reminder that unit tests against synthetic
  fixtures can miss a real-shape assumption that only a real-pipeline integration test catches.
- Phase-5 handling: fixed-in-phase, before ship. `sampleFieldNames` now iterates
  `template.formFields` (which carries both `fieldId` and `fieldName`) and reads
  `fieldValues[field.fieldId || field.fieldName]`, then reports the match under the PDF's real
  `fieldName` (what `form.getTextField()` needs). Re-verified: the renderFiling integration test now
  reports `sampledFields > 0` against the real H-1B golden case.
- Status: resolved
- Planned fix phase: n/a (fixed here). Recommend future services that read `caseForm.fieldValues`/
  `filledData` always resolve through `template.formFields[].fieldId`, never assume a flat key is a
  ready-to-use PDF field name, even though the two are equal for most real fields today.
