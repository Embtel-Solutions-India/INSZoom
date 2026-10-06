# PERM Employer + Employee Checklists - Completion Report

## What was built (all on the existing engine - no second questionnaire system)
- **PERM case type** (`Backend/src/config/visaCategories.js`): `employer_employee`, `singleEmployee: true`, no USCIS forms (DOL process). Separate from the legacy "EB-2 PERM".
- **Two default checklists** (`questionnaires/permChecklists.js`, registered in `employmentChecklists.js`), auto-assigned at case creation through the normal default/role path:
  - `perm_employer_information` - 19 questions.
  - `perm_employee_information` - 24 information questions, 3 qualification questions (duration years/months shown only after "Yes"), repeatable Employment History, required documents.
- **Employment History**: existing `repeating_group`, no row limit, "+ Add Employment", Job 1/2/3 cards, delete with confirmation, End Date hidden/optional when "I currently work here", start <= end, hours 0.5-168, most-recent-first warning, both source instructions verbatim.
- **Documents**: resume, degree documents, mark sheets/transcripts, experience letters; Degree Evaluation only when institution country is set and is not United States (`questionnaireOnly`, never a case-level checklist item).
- **Single employee**: child count fixed at 1; `POST add-employee-slot` returns 409 `SINGLE_EMPLOYEE_MATTER`; "+ Add Employee" hidden in Client (EmployeeDashboard, InvitePanel) and Admin (CRMCaseDetail).
- **Validation**: server row validator (`repeating-group-validation.js`) mirrored in the client (`utils/repeatingGroup.js`); optional fields no longer fail format rules when empty; State ID (8-9 digits) and EIN stored as digit strings so leading zeros survive.
- **Canonical mapping**: existing paths reused (person.*, contact.*, immigration.*, education.0.*, company.*); history -> `employment.history`. No USCIS form mapping.
- **Admin**: PERM option in CreateCaseModal with read-only structure preview.

## Changed files
Backend: `config/visaCategories.js`, `config/geoOptions.js` (new), `modules/cases/case.controller.js`, `modules/cases/immigration-knowledge-engine.service.js`, `modules/document-requirements/document-requirement.resolver.js`, `modules/questionnaires/{employmentChecklists,permChecklists,definitionHelpers,repeating-group-validation,questionnaire.service}.js`, tests `permChecklists.test.js` (new, 29), `i140Checklists.test.js`, `tnChecklists.test.js` (count 25 -> 27).
Client: `components/questionnaire/{QuestionInput,EmployeeDashboard,InvitePanel}.jsx`, `utils/{questionnaireEngine,repeatingGroup}.js`, `utils/repeatingGroup.test.js` (new).
Admin: `components/CreateCaseModal.jsx`, `pages/CRMCaseDetail.jsx`.

## Verification
- Backend: 29/29 new PERM tests; 122/123 across questionnaire/case/document-requirement suites. The one failure (`case-lifecycle-form-provisioning`, staff-override rejection) fails identically with my changes stashed - pre-existing.
- Client: vitest 12/12, `vite build` OK. Admin: `vite build` OK.
- No DB-writing tests were run; no test cases/users were created.

## Assumptions / open items
- Helper text for State ID, EIN and contact person is my wording (source text not supplied).
- "Full Address" is a single text line because city/state/country/zip are separate questions; institution State/ZIP apply only to US institutions; extension is its own optional question.
- Canonical employment-history rows use the spec's keys (differs in shape from OCR-produced rows).
- Templates are created in the DB by `ensureDefaultVisaTemplates` (runs on case creation, or `POST /questionnaires/defaults/seed`); same mechanism as the I-140/TN checklists. Not yet verified end-to-end by creating a real PERM case - do that from Admin and delete it afterwards.
