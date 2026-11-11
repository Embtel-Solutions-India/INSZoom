# I-140 + I-485 (employment based, employer + employee): integration report

Date: 2026-11-12

## Case type
- Stored visa type **"I-140/I-485"**, shown as **"I-140 + I-485"** in the Admin dropdown, under **Employment based** (`config/visaCategories.js` `caseStructure: "employer_employee"`, `config/visaDropdown.js`, Admin `utils/visaOptions.js`). It uses the existing employment-based flow: an employer matter plus one case per employee, with the employer / employee roles. No new party model.
- Why a slash: the default-checklist lookup builds `RegExp("^" + visaType + "$")`, so a literal "+" in the stored visa type would never match and no default checklist would be assigned. Slash types ("B-1/B-2", "CR-1/IR-1") already exist. The shown name keeps the "+" (the backend display map `utils/visaDisplay.js` is updated; the Admin and Client copies of that file have a different shape and were not changed, so a list that prints the raw stored type may show "I-140/I-485").

## Checklists (`questionnaires/i140i485Checklists.js`, registered in `questionnaire.service.js`)
Employer matter: `i140_i485_employer_checklist` (the existing I-140 employer checklist). Each employee case: `i140_i485_employee_checklist` (the existing I-140 employee checklist), `i485_green_card_employee_checklist` (the existing Green Card checklist) and `i485_i864_employee_checklist` (the existing I-864 checklist, answered by the employee, as in the single-person I-485). All are clones with only role/portal/visa type changed: no question or document re-authored. They are default templates for this visa type and are assigned by the existing default-assignment path; existing cases are untouched.

## Canonical paths (same values for both forms)
The I-140 employee and Green Card checklists both write generic `beneficiary.*` paths, and the shared facts already use the same path: lastName, firstName, dateOfBirth, ssn, alienRegistrationNumber, email, i94Number, lastArrivalDate (a test checks each is in both tables). The employer checklist uses the I-140 petitioner table (`petitioner.*`); the I-864 checklist the family I-864 table. Concepts that the two questionnaires path differently (for example city of birth `cityTownOfBirth` vs the Green Card's combined `placeOfBirth`, phone `primaryPhone` vs `mobilePhone`, status expiry vs I-94 expiry) were NOT unified, since that would change autofill for existing I-140 and Green Card cases; the employee is asked those twice.

## Forms
I-140 (auto at creation), I-485 (fed by the Green Card checklist and, conditionally, the I-140 employee checklist), I-765, I-131, I-693, I-485 Supplement J, I-864 / I-864A / I-864EZ (conditional, case-manager decision), I-907, G-28. Adjustment of status only; no DS-260, no I-130.

## Tests actually run (DB-free, named files only)
Backend: i130Checklists (incl. new I-140 + I-485 test), familyChecklists.gcNvc, checklist-party-rewire (89 tables), family-workflow, questionnairePageVisaSync, visaDropdown, documentCategorySync, passportRequired, requiredQuestions, adminEdits. Admin: utils + Questionnaire page tests; Admin build. Not run: any DB-backed or end-to-end test, creating a real employer matter / employee case, form autofill.

## Not verified
- That the employer + employee creation flow assigns all three employee checklists to an employee case in a running system (the default-template lookup supports several defaults per visa; not exercised).
- That the I-485 form mapping reads the Green Card answers under the employee role.
- Field-level template-field manifest not produced.

## Deploy
Restart the backend (definitions and form mappings reconcile at startup).
