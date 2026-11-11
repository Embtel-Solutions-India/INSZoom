# Indian Timeline Cases: OCI, subtype "Adult Former Indian Passport Holder"

Date: 2026-11-12

## What was built
- **New dropdown section "Indian timeline cases"** in the Admin visa dropdown, below Single applicant and above Notice responses (`Admin/frontend/src/utils/visaOptions.js`: group labels and ranks; `INDIAN_TIMELINE_VISA_TYPES`).
- **Visa type "OCI - Overseas Citizen of India"** (value `oci`, stored visa type `OCI`), single-person, no forms (`config/visaCategories.js`, `config/visaDropdown.js`, Admin copy).
- **Subtype dropdown** in the Admin "New case" form (`CreateCaseModal.jsx`): after OCI is chosen a required "Checklist type" select appears (`INDIAN_TIMELINE_SUBTYPES`); the first subtype is "OCI - Adult Former Indian Passport Holder" (with its description). Each future subtype = one entry in that map, one filing-type entry and one checklist definition.
- **Case creation = the existing single-party filing mechanism** (`single-party-filings`, registry `config/filingTypes.js`, new entry `OCI_ADULT_FORMER_INDIAN_PASSPORT`, `section: "indian_timeline"`): it creates the single-person case for the client, links the client login, and assigns the subtype's checklist to the client. The entry is excluded from the status-change/extension/EAD pickers (`groupedForSelection`) and from the scaffold generator (`singlePartyChecklists.js`).
- **Checklist** `oci_adult_former_indian_passport_checklist` (`questionnaires/ociChecklists.js`, registered in `questionnaire.service.js`): client role, **not a default** of the OCI visa type (a later subtype never receives this one), **no canonical paths, no forms** (a test checks both). The four opening instructions are the checklist description. 73 items: contact (2), A personal (6), B family incl. conditional spouse fields (13), C employment incl. conditional employer/retired fields (5), D prior OCI history (repeatable), surrender/cancellation details, relatives in India (repeatable, optional), and the document categories (digital photo, signature, physical photographs as an acknowledgement, current/last Indian passport, naturalization certificate or parents' alternative, surrender certificate when naturalized in/after 2010, legal-status evidence and pending-extension evidence for non-US-passport holders, marital-status evidence incl. remarried/deceased/affidavit, name change, employment evidence by situation, family OCI cards (optional), previous Indian visa, US address proof by type, native-address proof for non-US nationals and dual citizens).
- Client sends the answers through the ordinary questionnaire flow; Admin reads the same answer rows (no new route).

## Tests actually run
Backend (DB-free, named files): `ociChecklist` (6: registration, no forms/mappings, naturalization, surrender year, legal status, marital evidence, spouse/employment/name change/visa/prior OCI/native address), `i130Checklists`, `familyChecklists.gcNvc`, `checklist-party-rewire`, `family-workflow`, `questionnairePageVisaSync`, `visaDropdown`: 77 pass. Admin vitest (utils + Questionnaire page) 74 pass; Admin build OK.
Not run: creating a real OCI case, the client portal rendering, upload/save/resume/submit end to end, organization isolation (no DB writes, no running app).

## Assumptions / limits
- Documents that "do not apply" are simply not shown (rather than a typed N/A); free-text answers accept N/A. A required document the applicant truly cannot provide has no N/A control.
- Digital photograph and signature are two separate uploads; the "send by email" wording is an instruction only.
- Physical photographs are an acknowledgement (not an upload).
- Marital status values: Single / Never Married, Married, Divorced, Widowed, Separated; "Remarried after divorce" and "certificate unavailable" are separate follow-up questions, not statuses.
- Not verified in a browser: that the client portal shows the checklist description (instructions) prominently, the single-option radio, and the repeatable-group add/remove controls exactly as in GC-NVC.
- The Questionnaires page lists the checklist under its own visa type ("OCI") via the visa options.

## Deploy
Restart the backend (definitions reconcile at startup); reload Admin.
