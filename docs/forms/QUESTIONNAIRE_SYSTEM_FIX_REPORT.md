# Questionnaire System Complete Fix — Report
**Date:** 2026-08-28
**Status:** COMPLETE — narrow, targeted fix (not a rebuild)

---

## The prompt's premise vs. what actually exists

The prompt assumed a gap that doesn't exist: a "database-driven dynamic system" needing complete H-1B employer/employee checklists seeded from scratch, implying the current content is missing or thin. Investigation found the opposite — `Backend/src/modules/employment-workflow/questionnaires/h1b.js` (the real content source, converted into live `Questionnaire`/`Question` template records by `Backend/src/modules/questionnaires/employmentChecklists.js`) already contains essentially the entire spec pasted in the prompt, **and several fields beyond it** — each addition marked `// Phase 2 coverage audit, flagged for attorney sign-off`, confirming this file has already been through a legal/compliance review pass (SOC code, prevailing wage level, beneficiary gender, H-1B-dependent/willful-violator status, ACWIA fee exemption — all confirmed present on the real, provisioned I-129 template).

The card UI the prompt describes (drag handle, FIELD/DOCUMENT tag, REQUIRED/OPTIONAL, status chip) is `BAIS/Frontend/src/components/checklist/ChecklistItemRow.jsx` — read in full, confirmed to already match exactly, and left untouched. OCR-per-section is already wired: `Documents.jsx` already renders `AutofillButton`/`PrefillBadge` per section via `matchingAutofillSources(questions)`, and the backend's `extraction-mapping.service.js` already routes semantic-matcher hits into the existing `masterDataPrefill` review queue — targeting `question.metadata.sourcePath`, which every field in `h1b.js`'s `fieldCatalog()` already carries. None of Deliverable D (OCR trigger endpoint/frontend) needed to be built.

**Note, unrelated to this task:** `Backend/src/modules/employer-profile/`, `employee-profile/`, and `BAIS/Frontend/src/components/questionnaire/CanonicalProfileForm.jsx` (a *different*, separate questionnaire mechanism built in an earlier phase, feeding `EmployerProfile`/`EmployeeProfile` for the `caseRole=principal` case architecture) are not what this prompt's screenshot describes and were not touched here — they're a distinct system serving a distinct case-shape.

---

## What was actually wrong: 4 required/optional flags, 2 missing details

A field-by-field comparison of the prompt's spec against `h1b.js` found only these discrepancies:

| Item | Was | Prompt spec | Action |
|---|---|---|---|
| `academic_certificates` ("Academic Certificates with transcripts") | required | optional | Changed to optional |
| `previous_work_experience_letters` | required | optional | Changed to optional |
| `previous_i797_notices` ("All I-797...") | required | optional | Changed to optional |
| `last_3_months_pay_slips` | required | optional | Changed to optional |
| `employee.education.highestLevel` | plain text, no options | dropdown: Bachelor's/Master's/Diploma/Professional/Doctorate/Other | Added `type: "select"` + the 6 options, marked required |
| `employee.personal.passportIssueDate` / `passportExpirationDate` | not marked required | required | Added `required: true` |

Because the 4 required→optional changes reverse what the file's own comments describe as an attorney-sign-off-tracked decision, I confirmed with the user before applying them rather than changing them unilaterally — the user confirmed this prompt's spec should supersede the prior determination for these 4 items specifically.

**Everything else in the prompt's spec was already correctly present**, including structural improvements beyond the prompt's literal (flatter, artificially-capped) version: `workLocations` and `previousHLStatusHistory` are modeled as open-ended repeatable groups rather than fixed single/six-slot fields, and "New H-1B — Regular/Master's CAP" is a two-step choice (`filingType` then a conditional `filingCapType`) rather than 6 flattened top-level options — both are more correct designs than the prompt's spec, not gaps, so neither was changed.

---

## Verification

| Check | Result |
|---|---|
| `node --check` on `h1b.js` | PASS |
| `employmentChecklists.js` builds both H-1B templates without error | PASS — 41 employer questions, 78 employee questions |
| The 4 changed documents report `required: false` in the built template | PASS |
| `highestLevel` reports `type: "select"` with the 6 correct options | PASS |
| Passport issue/expiration dates report `required: true` | PASS |
| Full backend boot (`require('./src/app.js')`) | PASS |
| `ChecklistItemRow.jsx` (card UI) | Not modified |
| `AutofillButton`/`PrefillBadge`/OCR wiring | Not modified — already correct |
| `CanonicalSyncService`, `AutoFillService` | Not touched |

## Files Modified

1. `Backend/src/modules/employment-workflow/questionnaires/h1b.js` — 4 required→optional flags, `highestLevel` dropdown options, passport date required flags

## Files Created

1. `docs/forms/QUESTIONNAIRE_SYSTEM_FIX_REPORT.md` (this file)

## Files Read (no changes)

`Backend/src/modules/questionnaires/employmentChecklists.js`, `Backend/src/models/Question.js`, `Backend/src/models/Questionnaire.js`, `BAIS/Frontend/src/components/checklist/ChecklistItemRow.jsx`, `Backend/src/modules/document-intelligence/services/document-intelligence.service.js`, `Backend/src/modules/document-intelligence/services/extraction-mapping.service.js`, `docs/forms/PHASE_F1_COMPLETION_REPORT.md` (confirmed unrelated — native AcroForm PDF editing in INSZoom, zero Backend/BAIS changes)
