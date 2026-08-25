### [P5-002] §E's filingPdf controller sketch destructured `{ caseForm }` from loadCaseForm, which returns the document directly
- Date: 2026-08-25
- Area / file(s): `Backend/src/modules/form-generation/controllers/FormGenerationController.js` (`filingPdf`)
- Category: route
- Symptom: none observed - caught during pre-work verification (§F), before any code was written,
  by re-reading `PDFGenerationService.loadCaseForm`'s actual source rather than trusting §E's own
  controller sketch.
- Reproduction: §E's §I.3 sketch wrote
  `const { caseForm } = await PDFGenerationService.loadCaseForm(req.params.caseFormId);`. Had this
  been used verbatim, `caseForm` would be `undefined` (destructuring a non-object return), and every
  subsequent line (`caseForm.status`, `caseForm.formTemplateId`, etc.) would throw
  `TypeError: Cannot read properties of undefined`.
- Root cause: `PDFGenerationService.loadCaseForm(caseFormId, options = {})`
  (`PDFGenerationService.js:30-50`) ends with `return caseForm;` - a plain Mongoose document, not an
  object wrapper. Confirmed directly against the pre-existing `draftPdf` controller action
  (`FormGenerationController.js:74`), which already calls it correctly with no destructure:
  `const caseForm = await PDFGenerationService.loadCaseForm(req.params.caseFormId, { readOnly: true });`.
- Causing action: n/a - a drift in this phase's own task specification, not a pre-existing code
  defect.
- Impact: none - caught before any code was written, per this phase's own mandatory pre-work
  protocol (§F item 1: "quote the exact line numbers... if a line number has shifted, note it - do
  not assume the spec is current").
- Phase-5 handling: fixed-in-phase (before ship). `filingPdf` calls
  `PDFGenerationService.loadCaseForm(req.params.caseFormId, { readOnly: true })` unwrapped, exactly
  mirroring `draftPdf`'s own proven call.
- Status: resolved
- Planned fix phase: n/a (fixed here, never actually shipped incorrectly).
