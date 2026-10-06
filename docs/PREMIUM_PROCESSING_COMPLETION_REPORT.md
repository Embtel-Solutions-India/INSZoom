# Premium Processing (Form I-907) - Completion Report

## What was built (all on existing engines - no second questionnaire / form system)
- **New case type "Premium Processing"** (`config/visaCategories.js`): single party, Form I-907 is the only form. Offered in Admin's Create Case dropdown with a read-only structure preview.
- **One checklist, "Form I-907 Information Checklist"** (`questionnaires/premiumProcessingChecklist.js`, 32 questions, field keys / required / conditional rules exactly per the approved mapping table; question key = field path with `.` -> `_`, e.g. `i907.filer.last_name` -> `i907_filer_last_name`).
  - Standalone case: it is the case's default `client` checklist (auto-assigned at creation, same mechanism as Green Card Renewal / SB-1).
  - Any other case: attached as an add-on (below).
- **Admin "Premium Processing" button** (Documents tab, every case except a Premium Processing case; managers only): themed centred confirmation ("Are you sure you want to upgrade this case to Premium Processing?") -> `POST /cases/:id/premium-processing/upgrade`. It assigns the checklist to the client, provisions Form I-907 on the case, records a `premium_processing_i907` add-on and a timeline/audit entry. Idempotent. Admin shows the same answers in a "Form I-907 Information Checklist" panel (editable, like the other checklist panels); the button turns into an "Upgraded" badge.
- **Client portal**: the add-on checklist renders as its own section **below** the case's regular checklists (`PremiumProcessingChecklist.jsx`, via `StaffRequestedItems`), with its own Save. It is a `staffRequest` reference, so it never replaces the case's own checklist as the role default. A standalone Premium Processing case shows it as the main checklist.
- **Auto-mapping into Form I-907** (`form-mapping/config/i907-crosswalk.js` + `seeds/i907-mapping.seed.js`): replaces the old auto-guessed graph (which read `company.name` for petitioner/beneficiary/contact names). 37 reviewed edges read each answer from `raw.questionnaireAnswers.<key>.value`: digits-only transforms for A-Number / Online Account / EIN, "same address" Yes/No checkboxes, physical address only when it differs, classification = case visa type (skipped on a standalone Premium Processing case). Unit tests assert every source key exists in the checklist.
- **Registry**: `Premium Processing` -> I-907 `AUTO_CREATE` + checklist AUTO; **PERM** -> ETA-9141 / ETA-9089 (DOL, `LATER_STAGE`) + both PERM checklists AUTO; every other visa's I-907 row keeps `CONDITIONAL` and gains the I-907 checklist as `EXPLICIT_CM` (never auto-assigned). Validator's required-coverage list includes both new types.

## Bug fixed on the way
`models/Question.js`'s legacy `showIf` mirror rejected the `not_empty` operator, so **any question whose first condition is `not_empty` silently failed to insert** (the bulk reconcile skips invalid docs). That dropped 6 of the new I-907 questions and PERM's conditional "Degree evaluation" document. The mirror now maps `not_empty`/`empty` and skips operators with no legacy equivalent. After the fix all 32 I-907 questions are in the DB.

## Changed files
Backend: `config/visaCategories.js`, `models/Question.js`, `modules/cases/{case.controller,case.routes}.js`, `modules/questionnaires/{questionnaire.service,premiumProcessingChecklist}.js`, `modules/form-registry/{visaFormMapping.validator,seeds/visaFormMappings.seed,seeds/checklistMappings.seed}.js`, `modules/form-mapping/{config/i907-crosswalk,seeds/i907-mapping.seed}.js`, `package.json` (`seed:i907-mapping`), test `questionnaires/tests/premiumProcessingChecklist.test.js` (11).
Admin: `components/{ConfirmModal(new),CreateCaseModal}.jsx`, `pages/CRMCaseDetail.jsx`, `services/api.js`.
Client: `components/questionnaire/{PremiumProcessingChecklist(new),StaffRequestedItems}.jsx`, `components/checklist/CaseIntakeExtras.jsx` (hand-rolled I-907 block removed), `Pages/Dashboard/Documents.jsx`.

## Applied to the shared DB (idempotent, versioned)
3 registry rows upserted; `checklistMappings` re-seeded (201 rows, 0 not found); I-907 mapping version activated (earlier versions kept - re-activate one to roll back); the I-907 Questionnaire reconciled in place (old 33 questions retired, not deleted).

## Verification
- Backend: 276/276 across `questionnaires/tests`; `i907-mapping-graph.test.js` 2/2 against the new graph. Admin and Client `vite build` OK.
- Resolved the live graph against sample answers: all mapped fields fill as intended.
- Client vitest: `Documents.test.jsx` (8 tests) fails identically with the original Documents.jsx - pre-existing, not from this change.
- **Not done:** no real case was created, so the full click-through (create Premium Processing case; upgrade button on an H-1B case; client fills; Form I-907 shows values) is unverified in the browser. Please run it and delete the test case afterwards.

## Assumptions / open items
- The earlier profile-only I-907 questions (camelCase keys) were retired; answers saved under them are not carried over, and the old Profile-style I-907 panel in the client is gone.
- Staff upgrade creates no payment (the Case Manager decides). The client-purchase flow (`purchaseAddon`) still exists and now assigns the same checklist.
- "Form Number" is a select (I-129, I-140, I-539, I-765, I-131, I-290B, Other) - my list; adjust if you want others. Receipt-number and EIN formats are validated.
- Upgrade is offered on every case (PERM included), as requested.
