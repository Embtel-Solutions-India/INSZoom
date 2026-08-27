# Form Generation Module

`modules/form-generation` generates USCIS-ready PDFs from existing `CaseForm.filledData` and `USCISFormTemplate` metadata.

## Required Template Metadata

- `USCISFormTemplate.pdfTemplatePath` or `pdfStorageKey` points to the official fillable USCIS PDF.
- `USCISFormTemplate.pdfFieldMappings` maps canonical case fields to PDF field names.
- `USCISFormTemplate.formFields[].pdfField` may be used for field-level mappings.

## Runtime Flow

1. Validate `CaseForm.filledData` against template and PDF mappings.
2. Map case fields to official PDF field names.
3. Render the official fillable PDF with `pdf-lib`.
4. Store generated PDFs as existing `Document` records.
5. Track versions in existing `CaseForm.generatedPdfVersions`.

## APIs

- `POST /api/forms/:caseFormId/generate`
- `GET /api/forms/:caseFormId/preview`
- `GET /api/forms/:caseFormId/download`
- `POST /api/forms/:caseFormId/approve`
- `POST /api/forms/:caseFormId/regenerate`
- `POST /api/forms/packages/generate`
