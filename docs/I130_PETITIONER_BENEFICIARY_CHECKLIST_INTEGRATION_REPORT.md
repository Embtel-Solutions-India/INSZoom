# I-130 case type: Petitioner + Beneficiary checklists (integration report)

Date: 2026-11-12

## What was found (existing)
- The business's verbatim I-130 questionnaire already existed (`family-workflow/questionnaires/familyBasedImmigrantPetition.js`, key `i130`), with canonical paths (`IR1_PETITIONER` / `IR1_BENEFICIARY` in `partyChecklistPaths.js`) feeding I-130, I-130A, I-864, I-485, etc.
- The IR/CR/F2A/F2B/F3/F4 family case types were removed earlier the same day (code + DB); only F1 remains of the old family loops.

## What was added
- New case type **I-130** (two-party, family structure): `config/visaCategories.js`, `config/visaDropdown.js`, Admin `visaOptions.js`.
- Two checklists, `i130_petitioner_checklist` and `i130_beneficiary_checklist` (`questionnaires/familyChecklists.js`), built from the existing I-130 questionnaire so **every question key and canonical path is unchanged**. Requiredness/applicability rules are in `questionnaires/i130Spec.js` (required, conditional visibility, `requireWhen`, optional). Marital status is now a select; spouse, naturalization, LPR, employer and document questions are conditional.
- Canonical paths: the two checklists reuse the IR-1 petitioner/beneficiary tables (`partyChecklistPaths.js`).
- Form registry: checklist mappings and form mappings for I-130 (I-130 always; I-130A for spouse; I-864/I-485/I-765/I-131/I-693 by filing path), validator list updated. All forms read the same canonical party values, so the checklists fill every associated form, not only I-130.

## Creating a case (all family types)
- Admin create form no longer asks "Petitioner is filing for their" or "Filing Path" for any family type.
- Petitioner and beneficiary name/email/phone are **optional** in the UI and server (`createFamilyCase`, route validator). No email means no login account, invitation or e-mail for that party. An invitation is sent only when beneficiary email and phone are both given; otherwise the case is "petitioner completes". With no filing path, forms depend on the registry defaults and can be set on the case later.
- Behaviour with all details supplied is unchanged.

## Tests actually run (DB-free only; no DB writes)
- Backend: `i130Checklists` (13), `familyChecklists.gcNvc`, `checklist-party-rewire`, `family-workflow` (25): all pass.
- Admin: vitest `src/utils` + `src/components` 319 pass; `npm run build` succeeds.
- Tests updated for new counts (75 path tables; +2 definitions) and the optional-chaining regex.
- **Not run:** the DB-backed tests and any end-to-end creation of a real I-130 case (per instruction, no DB writes). An earlier broad run accidentally wrote test data to the real DB; it self-cleaned except 3 `zz-tmp` users, left untouched pending your say.

## Unresolved / known simplifications
- Addresses remain the existing text answers (not structured).
- Naturalization date and place is one combined answer.
- Prior petitions: one answer with details.
- No explicit "none" option for family members.
- "Last shared address" is optional (the spouse condition depends on the petitioner's answer in the other checklist).
- Spouse trigger for I-130A reads `petitionSubType` ("Husband/wife"), which is no longer set at creation, so I-130A is not auto-added until the relationship is recorded.

## Deploy notes
Restart the backend (code-defined checklists reconcile at startup). No new env vars.
