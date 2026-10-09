# F-1 Reinstatement - integration report

## Case type
- Registry: `F1REINSTATEMENT`, label **F-1 Reinstatement**, single-party (`caseStructure: single`), form `I-539` (`Backend/src/config/visaCategories.js`; child of F-1 in `visaHierarchy.js`; filing type `F1_REINSTATEMENT` already existed in `filingTypes.js`).
- Visible everywhere a visa is chosen: New case / lead conversion / GHL "Visa selection required" (shared list in `Admin/frontend/src/utils/visaOptions.js`, which also lists every registry case type automatically), the client filing-type picker (reads `filingTypes.js`), and the Pipeline category defaults.
- Pipeline: non-immigrant (`categoryForVisa`); the registry endpoint `GET /cases/visa-types` now returns `pipelineCategory` per case type and New case / Add employee preselect it.

## Checklist (`modules/questionnaires/f1ReinstatementChecklist.js`)
- ONE client checklist "F-1 Reinstatement": Applicant Information, Most Recent Entry, Address Outside the USA, Application Type (+ conditional change-of-status fields), Information About the Sponsor, Employment & Financial Information, Documents (applicant / sponsor), Reinstatement Letter Questionnaire. 65 items, **all optional**, no defaults, no pre-selected option, legacy Dhaka/1230/Bangladesh examples absent.
- Sponsor answers use their own `client_sponsor*` keys, no canonical mapping into the applicant namespace; new I-20 is an upload, not a form.
- Shared concepts reuse the COS-F1 question keys / canonical paths so the existing I-539 crosswalk autofills.
- The old unused scaffold template in the database was replaced by this one.

## USCIS forms
- `I-539` AUTO_CREATE (primary), `I-539A` conditional (case-manager decision), `I-907` / `G-28` conditional. No I-765, I-20 or DS forms. Database: VisaFormMapping rows + checklist mappings upserted; `F1REINSTATEMENT` added to `visaTypes` of the three active templates that carry `COSF1` (I-539, I-539A, I-907).

## GoHighLevel
- Uses the existing outbound sync (`ghlCaseOutbound.js`): one opportunity per case, name taken from the contact/case as for other cases, pipeline from the case's chosen category (default non-immigrant), duplicate-safe via the marker/link.

## Tests
- New: `questionnaires/tests/f1ReinstatementChecklist.test.js` (6 tests). Related suites (questionnaires, form-registry, family-workflow, GHL, single-party) pass except pre-existing failures that also fail without these changes: ComponentRegistryAudit (I-129 overlapping pages), Idempotency/case-lifecycle-form-provisioning, single-party "route registrations" guardrail.

## Not done / open
- The conflicting application-type selection is stored as the client's answer and flagged in question metadata (`staffReviewIfDifferent`); no staff-review UI was added.
- I-539 PDF field-level mapping was not re-verified against the current official edition; it reuses the existing COS-F1/H-4 crosswalk keys.
- Country questions are select lists (no dedicated country type exists); phone/email/currency/date use existing types.
- Not run: end-to-end client save/reopen and PDF generation on a live case.
