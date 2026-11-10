# L1A Documentation Checklist - replacement report

New L-1A and L-1A Extension cases now get ONE checklist, **L1A Documentation Checklist**, instead of the old L-1A Employer + Employee pair. The L-1A Business Plan checklist is unchanged.

## What was inspected
- Templates are code definitions (`questionnaires/employmentChecklists.js`) reconciled into the `Questionnaire` / `Question` collections (`questionnaire.service.js` `reconcileDefinition`). Checklists reach a case two ways: `applicableQuestionnaires` (immigration-knowledge-engine, run by `orchestrate`) and the AUTO entries of `VisaFormMapping.checklistMappings` (`provisionChecklistAssignments`). Both end in `assignQuestionnaire`.
- The old pair (`l1a_employer_checklist`, `l1a_employee_checklist`, and the `l1aext_*` copies) are role-split (employer on the employer matter, employee on each employee case) and carry ~83 information questions that fed I-129 / I-129S / I-539 / I-907 through `partyChecklistPaths`.
- Uploads: `saveFileAnswer` -> `storeAnswerFiles` (S3 storage service) -> `saveAnswers` (append, 10 files per question, per-row lock) -> `syncDocumentRecordsFromFileAnswer` (Document record shown in the Admin documents list). All section-independent.
- Rendering: the client portal (`useQuestionnaireAnswers` + `CaseRoleChecklist`) and the Admin case editor (`ChecklistEditorModal`) collect every upload question into one extra "Documents" step.

## Configuration (`questionnaires/l1aDocumentChecklists.js`)
- `l1a_document_checklist` ("L1A Documentation Checklist", visa L-1A) and `l1aext_document_checklist` ("L1A Extension Documentation Checklist", visa L-1A Extension). Role `employer` (attached to the employer matter), draft + approval gate like every checklist, listed on the Questionnaire page.
- Three sections, in order: Documents from the U.S. Company (11), Documents from the Foreign (outside U.S.) Company (16), Documents Pertaining to Beneficiary, Spouse and Child (4) = 31 questions, all required, numbered within each section.
- Website questions: short answer with a web-address check. Managerial duties (foreign #13): ONE long answer; its four numbered areas are in the description. Emails / memos (foreign #14): ONE upload question; its four numbered points are in the description. Descriptions keep their line breaks (bullets / numbers) on the client and Admin screens.
- Document keys / categories reused from the old checklists, so storage records, the Admin documents list and progress gates are fed exactly as before.
- `settings.inlineDocuments = true` (new optional questionnaire setting, default false): the uploads stay inside their three sections instead of the shared "Documents" step. Only this checklist sets it; every other checklist renders as before.

## Old checklists for new cases
- Removed from the definition list (never re-seeded) and switched off as defaults in the database.
- `applicableQuestionnaires` no longer offers them to a case that does not carry one; `assignQuestionnaire` refuses to assign them (returns without assigning, logs `retired_checklist_assignment_blocked`); the manual "send questionnaire" action answers 409 `CHECKLIST_RETIRED`.
- The form mappings keep the old keys and gain the new one additively, so cases that still use the old checklists keep feeding their forms.

## Historical cases
- A case that already carries an old checklist (26 case documents at the time of the change) keeps it, with all its answers and files. It is never given the new checklist on top (`carriesRetiredL1aChecklist`, also applied in `resolveCaseQuestionnaires` and `assignQuestionnaire`). Nothing was deleted or migrated.

## Database changes (shared DB; script `Backend/scripts/apply-l1a-document-checklist.js`, dry run by default)
- Created the two templates; set `isDefault=false` on the four retired templates; added the new key to the L-1A / L-1A Extension I-129, I-129S, I-539, I-907 mapping rows (8 rows, additive). A restore file is written before applying.
- The two templates were then brought to the final layout through the app's own `reconcileDefinition` (only B513, a new test case with no saved answers, referenced the L-1A template).

## Tests executed
- Backend (node --test): `l1aExtensionChecklists.test.js` 10/10 (structure, order, numbering, answer types, website check, uploads equal to the old checklists' document types/categories, retired list + guard), `tnChecklists.test.js` 14/14 and `i140Checklists.test.js` 11/11 (definition counts updated 36 -> 34), `immigration-knowledge-engine.test.js` 9/9, `ChecklistFieldTraceabilityService.test.js` 19/19.
- Read-only check against the real data: existing L-1A cases still resolve only their old pair (+ business plan); a new L-1A employer matter resolves only the new checklist; a new employee case resolves none; the guard blocks the old checklist on a new case.
- Client (vitest): `useQuestionnaireAnswers` incl. new inline-documents test, questionnaire components - 41/41. Admin: checklist editor + answers panel 10/10. Admin and Client production builds succeed.
- NOT executed: a live browser run of fill / upload / save progress / submit (the standing rule is no end-to-end tests against the shared database). The upload, S3, Document-sync and submit code is unchanged and section-independent; please do one manual pass on a new test case.

## Known limitations / follow-up
- Every upload question in this app already accepts several files (up to 10). Single-file and multiple-file questions are therefore the same.
- The ~83 information questions of the old pair are not asked on new L-1A cases (documents-only, by decision), so those cases no longer autofill I-129 / I-129S / I-539 / I-907 from checklist answers. The managerial-duties answer is free text with no canonical mapping.
- Four `checklistMappings.test.js` failures (H-1B, family, L-1B/O-2/EB-5 gaps, scaffold) and the L-1A golden-path e2e (needs the old checklists and fails at the "checklist not released" gate) fail identically without these changes; they were not modified.
- Production: run `apply-l1a-document-checklist.js` once (creates the templates, switches off the old defaults, extends the mappings), then restart the backend.
