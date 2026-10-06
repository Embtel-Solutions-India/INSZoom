# PERM workflow + USCIS form mapping - implementation report

Status: in progress - see "Remaining gaps". Sections are filled in as each part is verified.

## 1. Existing PERM workflow discovered (reused, nothing duplicated)
- PERM is an `employer_employee` case type with exactly one employee (`config/visaCategories.js`, `singleEmployee`). Case creation (Admin > New Case > PERM) runs the normal `createCase` path: principal (employer) case + one employee child case (`B###-A`), `EmployerProfile` / `EmployeeProfile`, and the two code-defined checklists `perm_employer_information` / `perm_employee_information` assigned as default `employer` / `employee` role checklists (`questionnaires/permChecklists.js`).
- The employer logs into the Client Portal (Case ID + password), completes the employer checklist, and is then asked "How would you like to provide employees information?" - **I will fill it in myself** (an `Employees (1)` card with *Fill Information*, a 3-step wizard Documents -> Information -> Review) or **Invite each employee** (existing invite flow, employee sees only their own packet). Both are the existing `PrincipalCaseWorkspace` / `EmployeePacketStepper` components.
- Answers are saved through `questionnaire.service.saveAnswers` into MongoDB (`Answer`), documents through the existing client upload workflow (`Document` + storage), and Admin reads the same records (`QuestionnaireAnswersPanel`, Documents tab). No Admin-side copy exists.

## 2. DOL vs USCIS boundary
- ETA-9141 / ETA-9089 are registered for `PERM` as `LATER_STAGE` / `ONLINE_APPLICATION` rows, agency `DOL`, with no `USCISFormTemplate` (nothing is created as a CaseForm).
- USCIS forms are separate registry rows, all `CONDITIONAL`, `initialCaseCreation: false`, gated by stage triggers (below).

## 3. Stage gating (new - `config/permStages.js`)
The registry previously auto-created every CONDITIONAL / LATER_STAGE form the moment its template existed ("no-criteria provisioning"), which would have put I-485 / I-765 / I-131 on a new PERM case. Gating is now explicit:

| Stage (Case Manager action, Admin > Documents > PERM Stage) | Form |
|---|---|
| PERM created | none (checklists + documents only) |
| Mark PERM certified (optional ETA case number / date) | I-140 |
| Start adjustment of status | I-485 |
| Employment authorization applies | I-765 (eligibility category never inferred) |
| Advance parole applies | I-131 |

- `Case.permWorkflow` (principal + employee case), endpoint `PUT /cases/:id/perm-workflow` (managers only, forward-only, ordered), whitelisted VisaFormMapping trigger fields `permCertified / permAdjustmentStage / permEmploymentAuthorization / permAdvanceParole`.
- `uscis-form.service.js`'s legacy visa-type scan is guarded with `permStageAllowsForm`, because "PERM" had to be added to the I-140 / I-485 / I-765 / I-131 templates' `visaTypes` for the registry to resolve them.
- Tests: `form-registry/tests/permStages.test.js` (8).

## 4. Checklist -> canonical profile
Existing canonical paths are reused (`person.*`, `contact.*`, `immigration.*`, `education.0.*`, `company.*`). Added (registered in `canonical/config/permCanonicalPaths.js`, wired into `CanonicalFieldRegistryService`): employer address parts (`company.address.*`, the `address` answer fans out in `CanonicalBuilderService`), county, website, fax, additional phone, State ID, federal-contractor / ADA / union / apprentice, phone extension, company profile; education extras (`education.0.completionYear / institution*`); the four PERM qualification answers (`perm.qualifyingExperience*`, `perm.employerPaidEducationTraining`, `perm.currentlyEmployedByPetitioner`); employment history (`perm.employmentHistory`).
These PERM/DOL-only facts are deliberately NOT mapped onto any USCIS form.

## 5. Canonical -> forms (mapping graphs, activated)
All four read canonical paths only (so any case sharing the profile benefits), carry `checklistField, canonicalPath, formCode, formSection, formPage, pdfFieldName, dataType, required, confidenceLevel (HIGH/MEDIUM/LOW), source`, publish required fields with no source as `missingSourceTargets` (`MISSING_SOURCE` / `UNMAPPED`, visible to the Case Manager), and keep LOW-confidence suggestions off the active graph (`lowConfidenceTargets`). Mapping versions are append-only.

| Form | Active template | Mapped fields | Missing-source entries |
|---|---|---|---|
| I-140 | 2024-07-06 | 24 | 40 |
| I-485 | 2026-04-09 | 40 | 12 groups/fields |
| I-765 | 2026-09-22 | 19 | 25 |
| I-131 | 2025-01-20 | 23 | 19 |

Edition currency: see "Remaining gaps".

## 6. Bugs found and fixed by running the real workflow
1. `employment.history` was not a writable canonical path (the stored profile holds `employment` as an array): submitting the employee checklist crashed with a 500. Employment history now maps to `perm.employmentHistory`.
2. A question whose first condition used `not_empty` (PERM's conditional "Degree evaluation", and new I-907 questions) silently failed to insert (`models/Question.js` legacy `showIf` mirror).
3. Conditional follow-up questions (e.g. "how long?" after "Yes") never appeared live in the client portal because the server only returned currently-visible questions: `getQuestionnaireForCase` now also returns `hiddenQuestions`, merged into the client's live visibility check.

## 7. UI changes requested during this work
- Long questions take a full row; short ones stay two per row (`isWideQuestion`, `ChecklistItemRow wide`).
- Employment History is one full-width question.

## Remaining gaps
(filled in at the end)
