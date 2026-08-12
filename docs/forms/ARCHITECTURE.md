# USCIS Forms Architecture Memory

## Dependency Map

Browser Forms tab
-> `INSZoom/frontend/src/pages/CRMCaseDetail.jsx`
-> `uscisFormsApi.caseForms(caseId)`
-> `GET /api/uscis-forms/case/:caseId`
-> `authenticate` + `authorizePermissions("forms:read")`
-> `uscis-form.controller.getCaseForms`
-> `uscis-form.service.listCaseForms`
-> `getAccessibleCase(..., { allowStaleFallback: true })`
-> `ensureAssignedForms(..., { metadataOnly: true })`
-> `CaseForm.find({ caseId })` projected list rows
-> Forms table.

Open form
-> `USCISFormRenderer`
-> `uscisFormsApi.workspace(caseId, caseFormId)`
-> `GET /api/uscis-forms/case/:caseId/:formId/workspace`
-> `interactiveFormReviewService.open(..., { track: false, readOnlyOpen: true })`
-> `uscis-form.service.renderCaseForm(..., { readOnlyOpen: true })`
-> `CaseForm` + locked `USCISFormTemplate`
-> `FormMappingService.loadMappingVersion`
-> current `fieldValues`/`filledData`
-> rendered sections/pages/field overlays.

Edit/save
-> `USCISFormRenderer.savePendingChanges`
-> `PATCH /api/uscis-forms/case/:caseId/:formId/workspace/field`
-> `interactiveFormReviewService.saveField`
-> `AutoFillService.overrideField`
-> `CaseForm.fieldValues`/`filledData`/manual override history.

Draft PDF
-> `formGenerationApi.draftPdf(caseFormId)`
-> `GET /api/forms/:caseFormId/draft-pdf`
-> `formGenerationRoutes`
-> `requireCaseFormAccess`
-> `FormGenerationController.draftPdf`
-> `PDFGenerationService.loadCaseForm(..., { readOnly: true })`
-> `PDFRenderer.render({ flatten: false, watermark: "DRAFT" })`
-> `PDFFieldMapper`
-> official USCIS PDF template bytes
-> `pdf-lib` AcroForm fill
-> `application/pdf` response.

## Guardrails

- Do not put `uscis-form.routes` before `formGenerationRoutes` on `/api/forms`; generic `/:id` routes will swallow `/draft-pdf`.
- Do not start background DB recovery loops at module import time. Start them only after `connectDB()` and `server.listen()`.
- Do not make GET open/list paths write to MongoDB. Hidden writes make browser rendering depend on primary availability.
- Do not replace official USCIS PDFs with HTML placeholders. HTML may be an editing overlay only; final output must fill the official PDF.
- Do not claim PDF correctness from JSON responses. Verify `%PDF-` bytes, page count, and field values in the generated file.

