# US Passport Renewal for Minors - DS-11 Checklist (Indian Timeline Cases)

Date: 2026-11-12

## Registration (same mechanism as the OCI subtypes)
- Visa type `US-PASSPORT-MINOR` ("US Passport Renewal for Minors"): `Backend/src/config/visaCategories.js` (single-person, no forms), `Backend/src/config/visaDropdown.js` and `Admin/frontend/src/utils/visaOptions.js` (dropdown option under "Indian timeline cases"; `INDIAN_TIMELINE_VISA_TYPES`, `INDIAN_TIMELINE_SUBTYPES`).
- Filing type `US_PASSPORT_MINOR_DS11` (`Backend/src/config/filingTypes.js`, section `indian_timeline`, hidden from the status-change/extension/EAD pickers). It creates the single-person case and assigns the checklist through the existing `single-party-filings` path.
- Checklist `us_passport_minor_ds11_checklist`: `Backend/src/modules/questionnaires/usPassportMinorChecklist.js`, registered in `questionnaire.service.js`, excluded from the scaffold generator in `singlePartyChecklists.js`.
- Admin "New case" form (`CreateCaseModal.jsx`): when a visa type has exactly one subtype it is pre-selected (one-line change); the existing required "Checklist type" dropdown is otherwise unchanged.
- Treated as a passport *service*, not a visa: it reuses the Indian-timeline single-person/no-forms pattern; no new engine, collection or assignment mechanism.

## Eligibility and assignment
Not a default of the visa type; assigned only when staff create a case with this visa type (the subtype's own filing type names the checklist). Repeated assignment goes through the existing single-party assignment dedup. Existing checklists, answers and case workflows are not touched (their question keys use a separate `ds11minor_` prefix; a test checks no key is shared with any other checklist).

## Questions: 49 in five sections
1. **Minor Applicant Details (Form DS-11 Data)** - 16 (supplied Q1-16).
2. **Contact & Delivery Information** - 6 (supplied Q17-22: mailing address, in-care-of, same-as-permanent, permanent address, email, phone).
3. **Travel Plans & Emergency Contact Details** - 8 (3 travel, 5 emergency contact).
4. **Minor's Most Recent Passport Details & Product Selection** - 9 (category + book/first document set of 4 + a separate passport-card set of 4).
5. **Applicant's Parents' / Legal Guardians' Details** - 10 (Parent 1 and Parent 2, five each, separate keys `parent1_*` / `parent2_*`).

Prefill reuses existing canonical paths only for the minor: `person.firstName`, `person.lastName`, `person.dob`, `person.countryOfBirth`, `contact.phone`. Parents, addresses and passport fields are case-specific and are not mapped.

## Validation (server `validateQuestionValue` / `validateResponse` and the client engine use the same definition)
- **Always required:** names (first, last), DOB (valid, not future), SSN, city/country of birth, sex, height, hair, eye, occupation, mailing address, same-as-permanent, email, phone, product category, emergency name/address/phone/relationship, both parents' name, DOB, place of birth, citizenship.
- **Conditional:** state of birth (only when country of birth = United States); permanent address (only when same-as-permanent = No); previous document number/issue date/status/expiry (only for Book, Card or Both; hidden and not required for first-time); a second, separate passport-card record (only for Both).
- **Optional:** middle name, other names, A-Number (format checked when given), school, in-care-of, departure/return dates, countries, emergency email (format checked when given).
- **Formats:** SSN `123-45-6789` or 9 digits, `000-00-0000` accepted; email; phone (7+ digits, existing rule); height as feet/inches 1-6 ft, 0-11 in; A-Number 7-9 digits.

## Tests
`Backend/src/modules/questionnaires/tests/usPassportMinorChecklist.test.js` (8 tests): registration/isolation/no duplicates, section order and exact labels/options, required vs optional, every conditional (incl. Book/Card/Both and first-time), a complete first-time submission, SSN/A-Number/height/email/phone/date validation, canonical mappings. Result: pass, together with the five OCI test files, `gcNvcChecklist`, `questionnaireAssignmentDedup` and `visaDropdown` (regression). Admin: utils tests and build, see the run notes in the hand-off message.
Not run (per project rules, no DB-backed e2e): creating a real case, client-portal rendering, save/reopen against a database.

## Assumptions and conflicts
- **Section 2 placement:** the source says to keep Q17-22 in Section 1 unless the architecture requires otherwise. An empty section does not exist in this engine, so those six questions sit in Section 2 so that the heading exists; each appears once, in the supplied order.
- **No subsection control:** "A./B." headings in Sections 3 and 5 and the "Someone not traveling with minor" helper text are carried in the description of the first question of each group.
- **SSN:** no extra "has an SSN" question was added; the SSN is always required and the supplied instruction (or `000-00-0000`) covers the no-SSN case. The placeholder is accepted as given and flagged nowhere as a real SSN. No input mask exists in the shared question component (not added); format is validated instead. The answer is marked `metadata.sensitive`; nothing logs it.
- **Not enforced (the shared validator cannot compare two fields or compute age):** applicant is under 16; return date >= departure date. Both are guidance text only.
- **Both Book & Card:** the first document set is the Passport Book (description says so); a second set with " (Passport Card)" appended to the exact label holds the card.
- **Previous-document dates** are required when shown (including for Lost/Stolen); the source gives no exception.
- **`Stolen*`:** kept verbatim; the source supplies no meaning for the asterisk, and nothing is inferred.
- Dates are stored ISO and shown by the date picker (MM/DD/YYYY wording in helper text); parent "Place of Birth" is a single text field (City, State, Country).
- No guardian alternative exists in the model; Parent 1 / Parent 2 only.

## Deploy
Restart the backend (definitions reconcile at startup); reload Admin. No new env vars.
