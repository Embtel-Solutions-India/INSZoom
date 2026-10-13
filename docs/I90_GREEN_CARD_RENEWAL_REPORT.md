# Form I-90 — Green Card Renewal / Replacement / Correction / Update

## 1. What already existed, and what this work did

| Already in the repo (reused, not rebuilt) | Added or changed here |
|---|---|
| Case type `Green Card Renewal` (single-party, form `i-90`) in `visaCategories.js`; I-90 `AUTO_CREATE` row in `visaFormMappings.seed.js`; checklist link in `checklistMappings.seed.js`; official I-90 template (edition 01/20/25, 195 fields) in the DB; generic approval gate, Client portal renderer, Admin answers panel, canonical sync, autofill, traceability | The checklist itself (it had 24 free-text questions, **no canonical bindings**, none of the form's conditional items); the **canonical paths**; the **I-90 crosswalk + seed** (the active graph had 0 edges); server-side validation; fixes to three latent bugs found on the way |

No new case-type enum, model, questionnaire system or autofill implementation was created. The existing name `Green Card Renewal` was kept instead of introducing `I90_GREEN_CARD_RENEWAL_REPLACEMENT`, because every registry, resolver and seed already keys on it.

## 2. Files changed

| File | Purpose |
|---|---|
| `Backend/src/modules/questionnaires/greenCardRenewalChecklist.js` | Rebuilt checklist (93 questions, 6 sections), same key `green_card_renewal_checklist` so the stored template reconciles in place; old keys are retired, not deleted |
| `Backend/src/modules/canonical/config/i90CanonicalPaths.js` (new) | New canonical paths (`person.*`, `contact.*`, `immigration.*`), registered like the PERM paths |
| `Backend/src/modules/form-mapping/services/CanonicalFieldRegistryService.js` | Merges the I-90 paths into the registry (additive) |
| `Backend/src/modules/form-mapping/config/i90-crosswalk.js` (new) | 124 canonical→PDF edges; the only place USCIS field names appear |
| `Backend/src/modules/form-mapping/seeds/i90-mapping.seed.js` (new), `package.json` | `npm run seed:i90-mapping`; idempotent by checksum, earlier versions kept |
| `Backend/src/modules/form-mapping/services/MappingResolver.js` | Additive transforms: `digitAt`, `string`; `concat` accepts a `separator` |
| `Backend/src/modules/questionnaires/questionnaire.service.js` | `date` rule value `past`; opt-in `metadata.strictOptions`; `assertStrictChecklistsSubmittable`; fixed `normalizeVisaForTemplates` (`/[-s]/` stripped the letter "s", not whitespace) |
| `Backend/src/modules/employment-workflow/employment-workflow.controller.js` | Case submit calls the strict check (only the I-90 checklist is opted in) |
| `Backend/src/modules/cases/case-lifecycle-orchestrator.service.js` | Fixed double assignment: `provisionChecklistAssignments` checked a stale in-memory case, so a case got two identical checklist references on first provisioning |
| `Backend/src/config/visaCategories.js` | Label → `Green Card Renewal / Lost`; the Admin dropdown shows **"I-90 - Green Card Renewal / Lost"** |
| `Admin/frontend/src/pages/CRMCaseDetail.jsx` | Panel title = new questionnaire name |
| `Backend/src/integrations/ghl/ghlAuxOutbound.js` | Green Card Renewal now defaults to the immigrant pipeline |
| Tests (new/rewritten) | `greenCardRenewalChecklist.test.js`, `i90-crosswalk.test.js`, `green-card-renewal-e2e.test.js` |

Several of these files already carried your uncommitted edits (visaCategories, CanonicalFieldRegistryService, ghlAuxOutbound); my changes there are small and additive.

## 3. Checklist

Title: **Questionnaire for Form I-90 — Application to Replace Permanent Resident Card**. Sections: Application Reason · Applicant Identity · Address and Contact Information · Permanent Residence and Admission Information · Accommodations · Supporting Documents.

**Required/optional.** In this platform `Question.required` is always stored `false` and *Submit needs every visible question answered*. So "optional" is expressed as a gate ("Do you have a middle name?", "Is your physical address different?", reason-specific follow-ups). Each question records `metadata.requirement` (`required` | `conditional`), `canonicalType`, `normalization`, `formRef` ("Part 1, Item 3.b") and `pdfAutofill`; tests keep these consistent with the conditional logic and with the crosswalk.

**Reason logic.** `i90_applicationReason`: `renewal`, `replacement`, `correction`, `biographic_update` (your four values and labels verbatim) plus `other` — the real form has further Section A reasons (turned 14, commuter status, automatic conversion, prior edition), so without it those clients could not use the questionnaire. Follow-ups shown only for the chosen reason:
- renewal → card expiration date
- replacement → lost / stolen / destroyed / mutilated / never received → date, description; mutilated → "do you still have the card?"
- correction → cause (USCIS error / applicant error / not sure) + repeating group of (item, incorrect value, correct value)
- biographic update → what changed, previous, new, effective date, legal document
- other → which reason (+ port of entry for commuter status)

A possible USCIS-caused error, any `other` reason, removal proceedings and I-407 answers carry `metadata.staffReview`. Only a USCIS-error answer ticks the form's "DHS error" box (2.d / 3.d); applicant error / not sure leave it to the case manager.

**Deviations from the supplied draft (the form wins):** mother/father — given name only (Items 12–13; no last-name boxes); port of entry is one "City, ST" box, stored as separate city/state and joined; added the form's own items: status type (Item 1), name on card (Items 4–5), ethnicity, race, removal proceedings, I-407, Part 4 accommodations, daytime phone/email; unit-type + number instead of a free "Apt/Suite" field. Two-photo requirement from the old checklist was dropped (not on your list).

**Documents** (each its own `documentType`; upload → `Document` record via the existing sync): passport (the only standing requirement) · previous card (if they have it) · state ID (if they have it) · SSN evidence (if they have an SSN) · birth certificate (correction/update) · legal-change evidence (update, or name changed) · loss evidence (lost/stolen/destroyed/never received) · correction evidence · other-reason evidence. Tax returns and extra evidence are **not** standing questions; the case manager requests them through the existing "Additional Requested Information". File type/size limits are the platform's (10 files, 50 MB).

## 4. Canonical mapping and provenance

The applicant files for themselves, so existing filer namespaces are used (`person.*`, `contact.*`, `immigration.*`); `beneficiary.*` is the petitioned-for-person namespace and is not used. Existing paths reused: `person.alienNumber/ssn/uscisOnlineAccountNumber/firstName/middleName/lastName/gender/dob/cityTownOfBirth/countryOfBirth`, `contact.address.*`, `contact.phone/email`. New (registered): `person.height.*`, `weightPounds`, `eyeColor`, `hairColor`, `ethnicity`, `race`, `mother/father.firstName`, `nameOnCard.*`, yes/no flags, `contact.physicalAddress.*`, `immigration.classOfAdmission/dateOfAdmission/portOfEntry.*/greenCard.*`, `person.accommodation.*`. A test rejects any path that looks form- or PDF-specific.

Path names were chosen around `CanonicalTransformationService.normalizeByPath` (e.g. a path ending in "name" is Title-Cased; "date" is ISO-formatted).

Provenance is the platform's: each canonical value carries `sourceType: questionnaire`, `sourceField` (question key), `sourceId` (the Answer, which records user, status and audit history), confidence by status (75 draft / 85 submitted / 95 approved), conflicts, and staff overrides (`staff_override`, priority 700) replayed on every rebuild — so a client resubmission does not erase a staff correction.

## 5. Approval, client flow, persistence

All unchanged, generic, and verified end to end: a new case starts gated; the case manager approves per checklist (`POST /questionnaires/case/:id/checklists/approve`; roles super_admin/admin/team_lead/case_manager; may edit the per-case copy first); the client then sees it; drafts save partially; the Admin Documents tab shows the same persisted answers (editable, with `staff_edited` audit). Another client gets 403.

**Known characteristic (shared, not changed):** the single-party "Submit case" button calls the employment-workflow submit, never `POST /questionnaires/:id/submit`, and that endpoint validated nothing. For this checklist only, I added a server check there: every visible question answered and every answer passing its format rules, else 422 (`CHECKLIST_INCOMPLETE` / `CHECKLIST_INVALID`). Other checklists behave as before.

## 6. Official I-90 PDF

Template: edition 01/20/25, active mapping **version 5**, 124 mapped edges, 64 manual, 7 USCIS-only barcodes. Verified: every edge's field exists in the template; a real temp case was autofilled and rendered with 0 failed writes / 0 unmapped; all 13 boxes ticked in that run, and **all 65 checkbox edges**, were checked by position against the printed label beside them (Part 2 reasons 2.a–2.j and 3.a–3.e, Yes/No pairs, race, eye/hair). Template labels for several widgets are wrong, so widgets were identified by tooltip and position; a test guards the Part 2 box order against a future edition.

Conditions re-check each gate against the canonical profile, so stale answers never print (e.g. a physical address after "different" was changed to No). Weight prints as three zero-padded digits. Unanswered fields stay blank.

**Not mapped (manual, by design):** In Care Of, mobile phone, Part 5 statements/signature/date, Part 6 interpreter, Part 7 preparer, Part 8 blocks beyond the two explanations the form requests. Renewal by a conditional resident, and "other" reasons for them, tick nothing (that is Form I-751).

**Coverage (Form Governance / checklist-trace):** 124/124 mapped fields traced to a question; 0 mapped without a question; no invalid canonical paths. 18 canonical fields have a question but no PDF consumer (card expiry, incident details, correction/update narrative — the form has no box; they inform the case manager).

## 7. Tests

- `greenCardRenewalChecklist.test.js` (26, pure), `i90-crosswalk.test.js` (13, pure): **39/39 pass**.
- `green-card-renewal-e2e.test.js` (shared DB, cleans up everything it creates): provisioning only I-90, idempotent; gate; access control; draft save; strict submit; canonical + provenance; autofill; persisted graph; traceability — **pass**.
- Regression run over the `questionnaires`, `form-mapping`, `family-workflow` and `cases` test folders: **653 tests, 646 pass, 7 fail.** The 7 are in other forms' suites: Phase 13 CaseForm provisioning, L-1B governance gap, I-129 golden-case canonical resolution, I-130/K-3 (two), I-539 beneficiary-name mapping, I-907 mapping graph. **I did not investigate them individually or compare against a clean checkout**, so I can't state they are pre-existing; the I-539 name-mapping failure is a known pre-existing one, and the I-129/L-1B ones touch files that already had your uncommitted L-1A work. The Phase 13 provisioning test is the one most worth a look, because I changed `provisionChecklistAssignments`. Nothing in the I-90 tests fails.

## 8. Open items / caveats

- **Live database writes:** mapping version 5 activated, checklist template reconciled (32 old questions retired). Temp cases/users from tests and scratch runs were deleted (verified 0 left).
- **SSN / A-Number storage:** the platform has no field-level encryption for questionnaire answers (they sit in clear in `Answer`, `masterData`, canonical profile and `CaseForm`). Covered only by `metadata.sensitive` tag and key-name log redaction. Pre-existing gap, not fixed here.
- Admin frontend was not rebuilt/browser-checked after the one-line title and label edits.
- Staff-review flags (`metadata.staffReview`) are recorded on the questions; there is no UI that surfaces them yet.
- Single-party submit leaves answers in `auto_saved` status (canonical confidence 75, not 85) — shared behaviour.
- Pre-existing, untouched: the Adjustment of Status case type defaults to the non-immigrant GHL pipeline.
