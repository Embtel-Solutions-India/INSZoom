# Indian E-Tourist Visa - Subtype 1: Business Visa

Date: 2026-11-12

## Registration (same mechanism as the OCI subtypes; checklist-only)
- Visa type `INDIAN-E-TOURIST-VISA` ("Indian E-Tourist Visa", dropdown value `indianetourist`) under "Indian timeline cases": `Backend/src/config/visaCategories.js` (single-person, `forms: []`, `noForms`, two subtypes), `Backend/src/config/visaDropdown.js`, `Admin/frontend/src/utils/visaOptions.js` (dropdown option, `INDIAN_TIMELINE_VISA_TYPES`, `INDIAN_TIMELINE_SUBTYPES` - the existing OCI-style "Checklist type" dropdown appears with two options).
- Filing types (`Backend/src/config/filingTypes.js`, section `indian_timeline`): `INDIAN_ETOURIST_BUSINESS` ("Business Visa") -> checklist `indian_etourist_business_visa_checklist`; `INDIAN_ETOURIST_SUBTYPE_2` ("Second subtype (checklist not yet configured)", a placeholder because no name was supplied) with `questionnaireKey: null`.
- The subtype is stored as `Case.petitionSubType` by the existing single-party filing path; one case, the subtype only decides the checklist. Business Visa is not a default of the visa type, so the second subtype never receives it.
- **Small shared change for a subtype without a checklist:** `single-party-filing.controller.js` (create and change-type) and `singlePartyChecklists.js` (scaffold generator) skip a filing type whose `questionnaireKey` is null, so the case is created with no checklist and no scaffold. No other filing type is affected.
- Checklist: `Backend/src/modules/questionnaires/indianEtouristBusinessChecklist.js`, registered in `questionnaire.service.js`; keys `inbiz_*`.

## Content
- 12 sections in order: Preliminary, A-J, K. 107 entries: 2 + 15 + 10 + 4 + 15 + 2 + 6 + 9 + 12 + 8 + 6 + 18.
- Section H has 11 source questions + one follow-up `If Yes, state details` (Q1, as instructed); Section I has 7 + `If Yes give details`.
- Section K has the 16 documents in the supplied order as 18 entries: K1 is two upload slots (Photograph, Signature, each with its Part text); Physical Photographs is a confirmation radio plus an optional supporting file. Heading, instructions, all option lists, helper texts, the `lndia` spelling and the curly apostrophes are verbatim.
- The source heading, closing note, legal disclaimer and agency contact details are deliberately NOT included (only section names, questions and the opening instructions); a test checks no agency or legal text appears anywhere in the checklist.

## Validation rules
- **Required:** everything marked Required in the source, incl. K1, K2 (confirmation), K3, K5, K6, K7, K12, K13, K14, K16.
- **Conditional (hidden and never validated when not applicable):** Date of Marriage and spouse fields (Married); the five other-passport follow-ups; Pakistan details; hotel name and Hotel booking document (hotel booked = Yes); tour operator details; e-Visa details; previous-stay fields (visited India = Yes, independent of the e-Visa answer); denial details; military details.
- **Optional:** other names, qualification institution, previous nationalities, Location 2, past occupation, K2 file, K8, K9, K10, K11 (their applicability cannot be decided from case data, so staff decide on review; none is required of everyone).
- **K4 (legal status, non-US passport holder):** the platform rule in `passportInformation.js` makes any question whose label mentions a passport always required once shown, and the label is fixed by the source. It is therefore shown (and then required) only when the applicant's own Current Citizenship is not United States, and hidden for US citizens. A non-US-citizen who actually holds a US passport would still be asked.
- Dates use the existing date picker with a "DD/MM/YYYY" hint; stored as ISO. Email and phone use the existing validation. Phone fields cannot take `N/A` (the platform strips non-digits); address and text fields can.

## Source inconsistencies kept as supplied
- `Visa Service Type Requested` is the single option `E-Tourist Visa` although the questionnaire is for a Business Visa.
- The "Note for Homemakers / Dependent Students ... above" sits on Current Occupation; K1 asks for photographs "via email" while the portal also offers uploads.

## Tests
`indianEtouristBusinessChecklist.test.js` (7 tests, pass): registration of both subtypes, no checklist or scaffold for subtype 2, no forms/mappings/canonical paths, dropdown copies, section order/counts/exact labels/options/helper texts, married vs not, every conditional, required vs optional, a complete unmarried application with only the required documents outstanding, validation errors, controller guard. Regression: US passport, five OCI files, GC-NVC, assignment dedup, passport-required, visa dropdown: pass. Admin: 13 utils files / 69 tests pass; Admin build OK.
Pre-existing failures (identical on a clean checkout, unrelated): 4 tests in `single-party-filing.test.js` (hard-coded filing-type counts/route snapshot).
Not run (project rules, no DB-backed e2e): creating a real case, client-portal rendering, real uploads, submission and Admin review of an actual case.

## Limits
- Checklist-only: no USCIS form, canonical mapping, form-generation job or registry entry was added.
- Switching a case's subtype uses the existing change-type behaviour (it deactivates the previous subtype's checklist); not altered here.
- Submission, Admin review and file display use the existing questionnaire/Answer pipeline and the Admin answers panel unchanged.

## Deploy
Restart the backend (definitions reconcile at startup); reload Admin.
