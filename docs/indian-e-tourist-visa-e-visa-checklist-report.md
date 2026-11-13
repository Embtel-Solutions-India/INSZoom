# Indian E-Tourist Visa — E-Visa subtype: implementation report

Date: 2026-11-13

## What was added

**E-Visa** is now the second subtype of the **Indian E-Tourist Visa** case type (Indian Timeline Cases). Selecting *Indian E-Tourist Visa → E-Visa* assigns the E-Visa questionnaire and document checklist (Sections A–K) to the case. The existing **Business Visa** subtype is unchanged.

The subtype follows the same architecture as the Business Visa and OCI subtypes: a filing type names a code-defined checklist (`questionnaireKey`); the checklist is created lazily as a built-in template, assigned to the case through the existing assignment flow, answered in the client portal and visible in Admin through the existing case-scoped questionnaire / document persistence. No new engine, API, model or route was created.

## Files changed

| File | Change |
|---|---|
| `Backend/src/modules/questionnaires/indianEtouristEvisaChecklist.js` | **New.** The E-Visa checklist definition (key `indian_etourist_evisa_checklist`, question keys `inev_<name>`). |
| `Backend/src/config/filingTypes.js` | `INDIAN_ETOURIST_SUBTYPE_2` (the former placeholder) is now labelled **E-Visa** and carries `questionnaireKey: "indian_etourist_evisa_checklist"`. |
| `Backend/src/config/visaCategories.js` | `INDIAN-E-TOURIST-VISA.subTypes` is now `["Business Visa", "E-Visa"]`. |
| `Backend/src/modules/questionnaires/questionnaire.service.js` | Registers `INDIAN_ETOURIST_EVISA_DEFINITIONS` in `VISA_TEMPLATE_DEFINITIONS`. |
| `Backend/src/modules/questionnaires/singlePartyChecklists.js` | `INDIAN_ETOURIST_SUBTYPE_2` added to `REAL_CONTENT_KEYS`, so no scaffold checklist competes with the real one. |
| `Admin/frontend/src/utils/visaOptions.js` | The second subtype option is now **E-Visa** (value `INDIAN_ETOURIST_SUBTYPE_2` unchanged, so existing selections keep working). |
| `Backend/src/modules/questionnaires/tests/indianEtouristBusinessChecklist.test.js` | Two assertions that described the placeholder updated (second subtype now has a checklist; two checklists for the visa type). |
| `Backend/src/modules/questionnaires/tests/indianEtouristEvisaChecklist.test.js` | **New.** E-Visa tests. |

The subtype value `INDIAN_ETOURIST_SUBTYPE_2` was kept (only its label and checklist changed) so any case already created with that value stays valid.

## Checklist content

Sections, in order, with the exact labels supplied: A Personal Particulars (17), B Passport Details (10), C Contact Information (4), D Family Background (15: father, mother, spouse), E Ancestry & Origins (2), F Visa & Travel Preferences (6), G Purpose of Visit & Itinerary (9), H Travel History & Background (12), I Occupation & Employment Details (8), J References (6), K Mandatory Document Checklist (3) — 92 items.

- **Answer types:** text, phone, email, date (DD/MM/YYYY, validated), multiline text, single-select / radio (Yes / No), country selectors for country and nationality fields.
- **Conditional fields** (never required while hidden): Date of Marriage and the five spouse fields (Marital Status = Married); the five other-passport fields; Pakistan-origin details; hotel name; tour operator details; previous e-Visa application details; the four previous-visit fields; denial details; military / security details.
- **Required status** as supplied; optional: Previous / Other Name(s), the three "previous nationality" fields, Location 2, Past Occupation, Invitation Letter.
- **Visa Service Type Requested** is a single fixed value, *E-Tourist Visa* (one choice, so it cannot be changed). **Requested Visa Duration / Validity** offers 30 Days, 1 Year, 5 Years.
- **Document checklist** (each an upload, with upload status, saved against the case; format "Email Attachment"): Current Valid Passport (required), Recent Passport-Style Color Photograph (required), Invitation Letter (optional — required only if applicable; whether it applies cannot be decided from case data, so staff decide on review).
- **Notes from the source** ("Note for Homemakers / Dependent Students", "FATHER'S DETAILS", "MOTHER'S DETAILS", "SPOUSE'S DETAILS", "REFERENCE IN INDIA", "EMERGENCY CONTACT (HOME COUNTRY)", "provide details if Yes") are shown as the helper text under the question they belong to, not as extra questions.
- Added only where the supplied spec asked for a conditional follow-up without naming it: "If Yes, state details" (previous e-Visa application) and "If Yes, give details" (military / security). The original question labels are untouched.
- No USCIS forms, no canonical mappings, no agency branding / contact details / legal text, no banner (the checklist has no description).

## Tests

`Backend/src/modules/questionnaires/tests/indianEtouristEvisaChecklist.test.js` (DB-free): registration and isolation (own key, no scaffold, two checklists for the visa type, no question key shared with another checklist, no mappings, Business Visa unchanged); exact section counts, labels and order; answer types and select options; required / optional status; every conditional group hidden and not required on *No* / *Single*, visible and required on *Yes* / *Married*; the three-document checklist (uploads, required / optional, distinct document types); required-field validation behaviour.

Results: E-Visa + Business Visa + lazy-template-loading tests — **21 passed, 0 failed**. Regression sweep (visa dropdown, creatable visa types, document category sync, OCI checklist, GHL visa mapping): passed. Two tests outside this change fail with or without it (`TemplateVisaTypeDrift` registry-wide drift, and `adminEdits` "updateQuestion records the changed fields"); they are part of the known pre-existing failures.

Admin and the other portals still build. Subtype selection, client submission and Admin visibility use the existing, shared code paths (identical to the Business Visa subtype); they were verified through the DB-free tests above, not by running a case end to end.
