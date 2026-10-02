# Session summary — mobile responsiveness, K-1/K-3 family workflow, multi-file document rows

Written 2026-10-03. This records what was changed in this session and, just as important, what was **not** verified. No change here was exercised in a real browser or against a freshly created K-3 case.

## 1. Mobile responsiveness (Landing, Client, Admin, Attorney)

- **Client portal** (`Immiglance/Client/src/layout/PortalLayout.jsx`): sidebar is now a slide-in drawer below 1024px (hamburger, backdrop, closes on route change); desktop collapse behaviour unchanged; sticky header.
- **Admin / Attorney shells** (`Admin/frontend/src/layouts/Layout.jsx`, `Attorney/src/layout/AppLayout.jsx`, `Attorney/src/components/NotificationBell.jsx`): tighter header/page padding on phones; notification dropdown spans the screen on mobile.
- **Page-level sweeps** (one pass per app): grid fallbacks, table scroll wrappers, wrapping toolbars/tab bars, modals that fit the viewport, 16px inputs on mobile (stops iOS zoom), larger touch targets. Landing navbar no longer overflows at 360px; Book Consultation goes single-column at 768–1023px (the one deliberate tablet-layout change).
- All four apps build. Never viewed at real phone widths.

## 2. K-3 checklist behaviour (family workflow, shared by all family visas)

- `Backend/.../family-workflow.controller.js` `submitParticipantInfo`: Submit is rejected (400 `REQUIRED_FIELDS_INCOMPLETE`) unless every checklist assigned to that role has all required fields/documents. Re-submitting is allowed and recorded as "Updated". Save progress remains a free draft save.
- `FamilyWorkflowCaseView.jsx`: submitted checklists are no longer locked; button reads "Update submission" after the first submit; Submit is disabled with a "N required items remaining" note until complete; the petitioner can fill and submit the Beneficiary card unless a beneficiary was actually invited.
- `FamilyCompletionModeBanner.jsx`: shows the invited person's name and email, and no longer resets to "invite someone" (it refreshed checklists but not the case).
- `Documents.jsx`: the Re-scan button is hidden when the checklist has nothing to scan.
- `Backend/.../cases/case.service.js`: a user attached as `beneficiaryUser` who already had a plain `client` account can now find and open the case (access check + "my case" filter).

## 3. One case for K-1 / K-3 (no parent + "-A" child)

- Root cause: Admin's create modal sent K-1/K-3 through `POST /cases`, which creates a principal case plus a lettered child case (e.g. B160 and B160-A).
- `Admin/frontend/.../CreateCaseModal.jsx`: K-1 and K-3 now use the family-workflow create endpoint (one case with `petitionerUser` + `beneficiaryUser`, both checklists). Lead conversion carries over.
- `Backend/.../cases/case.controller.js`: `createCase` returns 400 `FAMILY_CASE_REQUIRES_FAMILY_WORKFLOW` for any family-structure visa.
- `family-workflow.controller.js`: `createFamilyCase` accepts `leadId`, marks the lead converted, returns 409 if already converted.
- **Existing data is not migrated.** The DB still contains B160 (main) and B160-A (child), both created 2 Oct before the fix. Create a new K-3 case to verify.

## 4. K-1 / K-3 form autofill (petitioner vs beneficiary)

Root causes found: workspace fill ignored mapping conditions/transforms; the I-130 graph had lost its checkbox conditions (Male+Female both ticked); petitioner and beneficiary data shared one canonical namespace (passport scans collided → `CANONICAL_NEEDS_REVIEW` 422, wrong person's name could win; case `user` is the beneficiary account, so its email/name landed in petitioner/sponsor slots); only ~35 fields mapped per form; wrong box indexes (K-3 "Single" ticked "Separated"; I-129F item 26 fed citizenship instead of country of birth); SSN/A-number blanked at render by the widget fitter; pre-provisioned forms kept a stale mapping lock; a date timezone shift.

- New: `form-mapping/services/AddressParser.js`, `form-mapping/config/family-crosswalk-helpers.js`, `canonical/config/familyPartyPaths.js`, `questionnaires/familyCanonicalPaths.js`, `form-mapping/tests/family-role-mapping.test.js` (17 tests).
- Rewritten crosswalks: `i129f-k1-crosswalk.js` (271 mapped fields), `i130-k3-crosswalk.js` (209), plus seeds, `MappingResolver`, `FormMappingService`, `MappingGraphService`, `AutoFillService`, `ChecklistFieldTraceabilityService`, `CanonicalBuilderService`, `familyChecklists`, `canonicalPathFixes.seed`, `CanonicalBiographicAutofill`, `uscis-form.service`.
- Rule enforced and tested: Part 1 / Part 2 (I-129F) and Part 2 / Part 4 (I-130) widgets read only `petitioner_*` or `beneficiary_*` answers.
- Deliberately left blank: petitioner biographic block (I-129F Pt4, I-130 Pt3), "current spouse" slots, foreign province, other names, phone numbers, IMB name/address.
- Not hand-mapped (generic role-aware biographic fallback only): I-130A, I-485 Supp A, I-765, I-131, I-485, I-693, G-325A.
- **Action required on the live DB:** run `npm run seed:i129f-k1-mapping` and `npm run seed:i130-k3-mapping` in Backend. Already-provisioned/generated forms pick up the new mapping only on Refresh/Regenerate, and only if they have no manual overrides.

## 5. Multiple files per checklist document row ("Add entry")

- Every checklist document row (questionnaire rows and legacy document-baseline rows) now appends up to **10 files**, each up to **50 MB**, enforced on the backend (including across separate requests) and in the client. Any file type except executables/scripts (blocked by name and sniffed content).
- Storage unchanged (local or S3 via `storage.service`); files live in `Answer.files[]`, each also gets a `Documents` record. Replace-vs-append root cause: `saveFileAnswer` and the Document-to-Answer sync wrote only the current request's files, and `createDocumentFromFile` re-versioned the existing document.
- New: `uploads/upload-limits.js`, `Client/src/utils/uploadLimits.js`, `Client/.../checklist/EntryFileList.jsx` ("Entry 1, Entry 2 …", remove, "Add entry"), `questionnaires/tests/answer-file-limits.test.js` (8 tests).
- New endpoints: `DELETE /questionnaires/:id/answers/files` (client cannot remove from an approved row; staff can) and `GET /questionnaires/:id/answers/files/download`.
- Admin shows every file labelled "label 1, label 2 …" with View/Download/Remove and "Add entry". Attorney shows labelled previews only (the portal's existing no-download policy was kept — differs from "viewable/downloadable").
- Review: approve/reject stays per file; the answer keeps one row-level status; the `documentsReviewed` gate needs at least one approved entry per row and none undecided (documented in `Attorney/docs/ATTORNEY_PORTAL.md` §9).
- `MAX_FILE_SIZE` raised from 10 MB to 50 MB in `Backend/.env` and `.env.example`.

## 6. Housekeeping

- DB: only two K-1/K-3 cases exist (B160, B160-A, both user-created). No test K-1/K-3 cases from this session remain in the app DB or the local test DB. Two H-1B fixture cases (`H1B-2025-GOLDEN`, `PHASE3-CONFLICT-…`) exist in the local `immigrationcrm_test` DB from test runs; left in place. **Nothing was deleted from any database.**
- The `ECONNREFUSED` / `ECONNRESET` Vite proxy errors seen during the session were the backend restarting (nodemon) while backend files were being edited; the backend is up on :7000 and all changed modules load.

## Test status

- Passing: family-role-mapping, K-1/K-3 crosswalk coverage, phase0 invariants, family-workflow, answer-file-limits, upload/document-upload tests, K-3 golden case (when run alone). Client, Admin, Attorney and Landing build.
- Known/pre-existing failure: "employer/employee templates are unaffected in count".
- **Open:** `document-intelligence/tests/h2-autofill.test.js` (live-DB) fails with a case `VersionError`; the upload agent could not tell whether its extra row-count query worsens the race. Not compared against a clean tree.
- **Open:** 8 Client vitest tests in `Documents.test.jsx` fail (`caseScanOptions is not a function` in `SmartScanStep`, mock gap) — looks pre-existing, unconfirmed.
- Other failing/unrelated in wider suites: H-1B H6/H1-I129 AC1 tests; form-generation tests that time out on `uscisformcomponentdefinitions.find()`.

## Not verified

Real-browser behaviour at phone widths; the K-3 flow end to end on a new case (invite → beneficiary checklist → Submit → extra entries → autofilled forms); rendered PDFs for every new mapped field; S3 and HEIC uploads; live DB mapping/questionnaire state.
