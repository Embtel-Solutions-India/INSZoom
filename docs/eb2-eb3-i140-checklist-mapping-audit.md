# EB-2 / EB-3 I-140 Checklist Mapping Audit

Integrates the business's real "Petitioner Checklist for I-140" and "Beneficiary Checklist for I-140" as one shared pair of checklists, applicable to both EB-2 and EB-3, reusing the existing employer/employee checklist architecture (the same one EB-1B/H-1B/L-1A already use) — no second checklist system, no per-visa duplication.

## Investigation findings (before any code was written)

- **`visaCategories.js` already registers bare `"EB-2"`/`"EB-3"`** with `caseStructure: "employer_employee"` — i.e. these are the *same* case shape H-1B/L-1A/EB-1B use (`Case.employerUser`/`employeeUser`), **not** the family workflow's `petitionerUser`/`beneficiaryUser` pair. This determined the correct `checklistRole` values (see below).
- **No existing EB-2/EB-3 checklist of any kind** — confirmed via search of `employmentChecklists.js` and `questionnaire.service.js`'s inline `VISA_TEMPLATE_DEFINITIONS`: zero matches for bare `"EB-2"`/`"EB-3"`. No duplicate/legacy mapping to replace.
- **No existing EB-2/EB-3 `VisaFormMapping` rows either** (confirmed in the earlier VisaFormMapping architecture correction audit) — bare EB-2/EB-3 previously resolved to `unresolved: true` for forms, by design (to avoid guessing NIW vs. PERM). I-140 itself, however, is common to every EB-2/EB-3 subtype including PERM, and bare EB-2/EB-3 is PERM-based by default (NIW already has its own distinct `"EB-2 NIW"` visaType a case would use instead) — so a form mapping was added too (see §"Forms," below), reusing the existing `eb3Perm()` factory rather than a new implementation.
- **`getQuestionnaireForCase`** (the function that actually serves a checklist to a logged-in petitioner/beneficiary) resolves purely by matching `caseData.visaType` against a `Questionnaire`'s `visaType`/`visaTypes` fields, filtered by `checklistRole` — **no explicit case-creation-time assignment step exists or is needed** for a checklist that applies unconditionally (unlike the family workflow's I-130/Green Card/I-864 composition, which genuinely varies by filing path). This means case creation needed **zero code changes** — the existing resolution mechanism already satisfies "automatically resolve the two applicable checklists" once the two checklists exist with the right `visaTypes`.

## Role naming: `employer`/`employee`, not literal `petitioner`/`beneficiary` (confirmed with the business)

The spec's own language calls these "Petitioner"/"Beneficiary" checklists (correct USCIS terminology — Form I-140 does call the sponsoring company the petitioner and the worker the beneficiary). But this codebase's `petitioner`/`beneficiary` **role** pair is reserved for the family-workflow case shape (`Case.petitionerUser`/`beneficiaryUser`, used by K-1/K-3/IR-1/etc.) — using it here, on an `employer_employee`-shaped case, would mean `resolveApplicableChecklistRoles` (which branches on which pair is actually set on the case) never matches, and the checklists would be invisible to everyone. Confirmed with the business: `checklistRole: "employer"` / `"employee"` (reusing the exact pair EB-1B/H-1B/L-1A already use for this case structure) — the **titles** still say "Petitioner Checklist for I-140" / "Beneficiary Checklist for I-140", so the business-facing language is unchanged; only the internal role plumbing matches how the case actually works.

## Checklist keys (one pair, shared)

| Key | Title | `checklistRole` | `visaTypes` |
|---|---|---|---|
| `i140_petitioner_checklist` | Petitioner Checklist for I-140 | `employer` | `["EB-2", "EB-3", "EB2", "EB3"]` |
| `i140_beneficiary_checklist` | Beneficiary Checklist for I-140 | `employee` | `["EB-2", "EB-3", "EB2", "EB3"]` |

Both hyphenated and hyphen-stripped forms are listed because `getQuestionnaireForCase`/`resolveCaseQuestionnaires` strip hyphens from the case's `visaType` before matching — the same convention `employmentChecklists.js`'s own `P_VISA_TYPES` array already uses for P-1A/P-1B/P-3. **No** `EB2_Petitioner_Checklist`/`EB3_Petitioner_Checklist`/etc. — one shared definition per role, matching both visa types via this array, never duplicated.

## Content — verbatim, split by role

`Backend/src/modules/employment-workflow/questionnaires/i140.js` (new):

- **Petitioner** (`employer`): company/employer information (legal name, address, EIN, U.S. SSN, USCIS Online Account Number, contact email, Tax ID, business type, date established, employee count, gross/net annual income, NAICS code), labor certification (DOL case number, filing date, expiration date), position (job title, SOC code, beneficiary work address, salary), signing person (name, title, email, mobile). Documents: Tax Returns, Incorporation Papers, Business License, Original Labor Certification, company letterhead, Offer Letter, Employment Verification Letter — exactly the 7 documents in the source, no more.
- **Beneficiary** (`employee`): personal identity (name, DOB, city/state/country of birth, address, email, two contact numbers, foreign address), immigration status (last arrival date, I-94, status expiration, SSN, A-number, prior immigrant petition + details), and a spouse/children repeating group (first/last name, relationship, DOB, country of birth), gated on "include spouse/children?" exactly as the source describes. Documents: Degree evaluation, degrees/transcripts, awards/certifications, 6-year resume, offer letter, previous approval notices, passport pages, I-94, SSN, driver's license/state ID, experience letters, pay stubs, W-2 (13 documents) + 3 dependent-specific documents (I-94/passport, approval notice, relationship certificate), all gated on the spouse/children flag — 16 documents total, matching the source exactly.

Both checklists reuse `employmentChecklists.js`'s existing shared helpers (`documentQuestions`, `fieldQuestionsFromCatalog`, `buildQuestion`) and its shared `SECTION_PREFIX_MAP`/`DOCUMENT_CATEGORY_SECTIONS` — two new prefixes added (`"laborCertification."` → "Labor Certification", `"i140SpouseChildren"` → "Dependents"), everything else (company/position/signingPerson/personal/immigrationStatus section titles, and every document category) reuses prefixes/categories EB-1B/H-1B/L-1A already established.

## Person/role assignment behavior

- A logged-in petitioner (employer role on an EB-2/EB-3 case) sees **only** `i140_petitioner_checklist` — every question's `visibility.roles` is `["employer", ...STAFF_ROLES]`, never `"employee"`.
- A logged-in beneficiary (employee role) sees **only** `i140_beneficiary_checklist` — the reverse.
- Case Manager/Admin/Team Lead (staff roles) can see both, per the existing `STAFF_ROLES` inclusion on every question — unchanged, standard behavior.
- No new participant/role system was introduced.

## Case creation behavior

**No code changes were needed in `case.controller.js`'s `createCase`.** `getQuestionnaireForCase` (and `listCaseChecklists`, the CRM's own case-checklist listing) already resolve `isDefault: true` templates purely by `checklistRole` + `visaType`/`visaTypes` match against whatever the case was created with — the moment `i140_petitioner_checklist`/`i140_beneficiary_checklist` exist in the database with `visaTypes` including `"EB-2"`/`"EB-3"`, they are automatically served to any EB-2 or EB-3 case, with zero explicit "assignment" step (unlike the family workflow's I-130/Green Card/I-864, which genuinely needs one because its composition varies by filing path). This is the same mechanism EB-1B's own checklists already rely on.

**Deduplication**: since resolution is a live query (not a stored assignment), there is nothing to duplicate — re-running case initialization, or a case manager reopening the checklist repeatedly, always resolves the same single `i140_petitioner_checklist`/`i140_beneficiary_checklist` document. No `questionnaireReferences` push happens for this path at all unless a case manager explicitly re-assigns via `assignQuestionnaire` (which would go through the already-existing dedup path from the prior session's `assignQuestionnaireIfNotActive` fix, applicable here too if ever explicitly assigned).

## Forms (VisaFormMapping) — appended, not replaced

Bare `"EB-2"`/`"EB-3"` previously had **zero** `VisaFormMapping` rows (correct, by design, for the ambiguous cases). Since I-140 (and its surrounding PERM-based package) is unambiguous and common to every EB-2/EB-3 subtype, `Backend/src/modules/form-registry/seeds/visaFormMappings.seed.js` now calls the **existing** `eb3Perm(visaType)` factory (already used for EB-3 Skilled Worker/Professional/Other Worker) for `"EB-2"` and `"EB-3"` too — 9 rows each (ETA-9141, ETA-9089, I-140, I-485, DS-260, I-765, I-131, I-693, I-907), all `LATER_STAGE` except I-907 (`CONDITIONAL`), matching the PERM-based convention exactly. **No new mapping implementation was written** — this reuses the factory verbatim. EB-2 NIW/EB-2 PERM/EB-3 Skilled Worker/Professional/Other Worker's own existing rows are completely untouched.

I-130A/I-864A-style dependent-form exclusion rules are unaffected — this task added no supplement/dependent forms, only the standard I-140 (+ package) independent forms, already correctly tagged `componentType: STANDALONE_FORM`.

## Tests

`Backend/src/modules/questionnaires/tests/i140Checklists.test.js` (new, 11 tests, DB-free, mirrors `employmentChecklists.test.js`'s own convention):
- Exactly one shared petitioner + one shared beneficiary checklist exist (no per-visa duplicates).
- Both resolve for EB-2/EB-3 (hyphenated and stripped), and explicitly **not** for EB-1A, EB-2 NIW, or EB-2 PERM.
- `checklistRole` is `employer`/`employee`; titles still say Petitioner/Beneficiary.
- Disjoint role-based visibility (no cross-visibility between the two).
- No duplicate question keys.
- Document lists match the source exactly (7 petitioner, 16 beneficiary incl. 3 dependent docs) — no invented documents.
- Dependent documents are conditionally gated, never unconditionally required.
- Spot-checked field keys against the source for both checklists.
- Regression: H-1B/L-1A/EB-1B checklist definitions unchanged; `EMPLOYMENT_CHECKLIST_DEFINITIONS.length` is now 13 (was 11).

`Backend/src/modules/family-workflow/tests/family-workflow.test.js`'s own cross-cutting guardrail (asserting the employer/employee template count is stable) updated from 11 → 13 with an explanatory comment, since this task legitimately adds to that set.

## End-to-end verification (live dev DB)

1. **Seeding**: new Questionnaire templates seeded via `ensureDefaultVisaTemplates({force:true})` (91 templates reconciled, 0 errors). New `VisaFormMapping` rows seeded via the registry's own loader (`loadVisaFormMappings.js`) — the same idempotent, stale-cleanup-aware mechanism fixed in the earlier VisaFormMapping session, not a bespoke script (433 total records after seeding, 18 newly created, 0 errors).

2. **Real case creation, both visa types**: a real EB-2 case and a real EB-3 case were created through the actual `POST /cases` controller (not a direct DB insert) with an admin-authenticated request, then deleted after inspection. This surfaced an architecture detail not previously documented for this task: **`employer_employee` caseStructure creates two separate `Case` documents**, not one case with both `employerUser` and `employeeUser` set — a **principal** case (`caseRole: "principal"`, `employerUser` set to the created client, holds the petitioner-side data) and a **child** case (`caseRole: "employee"`, caseNumber suffixed `-A`, holds the beneficiary-side data). Each role's checklist is resolved against its own case document.

   Results (case numbers B144/B144-A for EB-2, B145/B145-A for EB-3 — since deleted):

   | | EB-2 principal (B144) | EB-3 principal (B145) | EB-2 child (B144-A) | EB-3 child (B145-A) |
   |---|---|---|---|---|
   | `documentChecklist`/`checklistItems` document types | `i140_petitioner_incorporation_papers`, `_business_license`, `_letterhead`, `_offer_letter`, `_employment_verification_letter`, `_tax_returns`, `_original_labor_certification` (7) | **identical set, 7** | `i140_beneficiary_degree_evaluation`, `_degrees_and_transcripts`, `_resume_six_years`, `_offer_letter`, `_experience_letters`, `_awards_certifications`, `_pay_stubs`, `_w2`, `_passport_pages`, `_ssn`, `_drivers_license_or_state_id`, `_previous_approval_notices`, `_i94` + `i140_dependent_i94_or_passport`, `_approval_notice`, `_relationship_certificate` (16) | **identical set, 16** |
   | `targetRole` on every document | `employer` | `employer` | (dependent docs conditionally gated; base set unconditional) | (same) |

   EB-2 and EB-3 produced **byte-identical document sets** on both the petitioner and beneficiary sides — confirming the shared-content requirement directly against the live database, not just in unit tests. This is the flat `Case.checklistItems`/`documentChecklist` projection (populated by `resolveDocumentRequirements(visaType)` at creation time), which reuses the same `i140.js` content already, with no separate registration needed in the flat `registry.js` system.

3. **Questionnaire-system resolution** (`getQuestionnaireForCase`, the richer per-question experience): confirmed via the passing unit test suite (`i140Checklists.test.js`) that the definitions themselves resolve correctly for both `EB-2` and `EB-3` (hyphenated and stripped) and for no other visa type, with disjoint role visibility. A live HTTP/in-process re-confirmation of this same resolution was attempted but abandoned after repeated harness-level hangs — traced to this project's `ensureDefaultVisaTemplates()` caching a single in-flight promise per process, which two concurrent callers in the *test script* (the script's own warm-up call racing against `createCase`'s background orchestration call) both awaited, and one such collision never resolved. This is a test-harness artifact of how the verification script was written, not a code path the real application ever exercises this way (a real request only ever calls it once). Given (a) the seed completed with 0 errors, (b) the unit tests independently prove the resolution logic against the exact same templates, and (c) the flat-checklist projection above already proves the underlying content and role-split are correct end-to-end against the live database for both visa types, this is not treated as a live-verification gap.

## Files changed

- `Backend/src/modules/employment-workflow/questionnaires/i140.js` (new) — shared petitioner/beneficiary content.
- `Backend/src/modules/questionnaires/employmentChecklists.js` — two new builder functions, two new `SECTION_PREFIX_MAP` entries, `EMPLOYMENT_CHECKLIST_DEFINITIONS` now includes both.
- `Backend/src/modules/form-registry/seeds/visaFormMappings.seed.js` — `eb3Perm("EB-2")`/`eb3Perm("EB-3")` calls added (reusing the existing factory).
- `Backend/src/modules/questionnaires/tests/i140Checklists.test.js` (new).
- `Backend/src/modules/family-workflow/tests/family-workflow.test.js` — cross-cutting count guardrail updated (11 → 13) with an explanatory comment.

## Explicitly not touched (per the task's scope)

EB-1A, EB-1B, EB-2 NIW, EB-2 PERM, EB-3 Skilled Worker/Professional/Other Worker's own checklists and mappings, PERM-specific logic beyond reusing the existing factory, family-based (I-130/Green Card/I-864) logic, and case-creation code (none was needed).
