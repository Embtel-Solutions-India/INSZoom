# PHASE F-3 — FIX F-2 BLOCKING FINDINGS AND ACHIEVE FIRST CERTIFIED REAL CASE

**Status: PARTIAL — real fixes shipped and verified live; full certification blocked by two newly-discovered structural gaps (not the ones F-2 predicted).**

---

## 0. What actually happened, in one paragraph

F-2 diagnosed four "critical" findings (C1–C4) and guessed at their root causes. Investigating each one properly (not applying the guessed fixes blindly) found that **two of F-2's own root-cause guesses were wrong** — fixing them as literally proposed would have broken working mechanisms. The real root causes were different, smaller, and more precise. Both real fixes were made and confirmed working in a live browser against the actual app. A fresh, real H-1B case (B003 / B003-A) was then driven entirely through the real BAIS UI — real employer questionnaire, real invite-employee flow to a separate employee account, real employee questionnaire — reaching a point no case in this database has ever reached before. That process surfaced **two new, deeper structural bugs** that block the final "Generate USCIS Forms → 200" step, both documented precisely below with exact file/line evidence. Full certification (Part D–E's success criterion) was not reached. Nothing here was patched as a raw database write to canonical/questionnaire data — every real answer in this report was entered through the actual BAIS UI or the actual API endpoints a UI click would hit.

---

## 1. C1 — reinvestigated, and F-2/F-3's proposed fix was wrong

**F-3's Step 11 proposed fix:** make `createCase` set `Case.user = null` and `clientEmail = ''` on every child case at creation.

**Why that would have been wrong:** reading `case.controller.js`'s `inviteEmployee` handler (line ~1608) shows the invite-employee flow is *designed* around child cases starting out owned by the employer's own account:
```js
// Already invited: the child case's `user` no longer matches the
// employer's own account, meaning ownership was already transferred.
if (childCase.user && String(childCase.user) !== String(principal.user)) {
  return res.status(409).json({ success: false, code: "ALREADY_INVITED", ... });
}
```
It then transfers ownership (`childCase.user = employeeUser._id`) on invite. Nulling `user` at creation would break this ALREADY_INVITED check and the transfer logic outright — the exact opposite of a fix.

**The real root cause**, found by tracing the actual symptom (BAIS showing the employee's checklist to an employer login): `Case.controller.js`'s `getMyCase` (`GET /api/cases/my`, line 430) resolved "which case is this login's own case" via:
```js
Case.findOne(filter).sort({ createdAt: -1 })
```
For a user linked to both their own principal case and every one of its not-yet-invited children (all matching the same `{user: req.user._id}` filter, by the intentional pre-invite design above), this always returns whichever was created most recently — the child, created milliseconds after the principal in the same request. The employer's own "my case" endpoint permanently returned their employee's case.

**Fix applied** (`Backend/src/modules/cases/case.controller.js`, `getMyCase`): prefer the case matching `req.user.primaryCaseId` (set once at account creation and never repointed at a child for the original employer account, and correctly repointed at the employee's own child case when an invite is accepted) before falling back to the original sort.

**Verified live**, twice: (1) direct API call — `GET /api/cases/my` as the B002 employer now returns B002 (`caseRole: principal`), not B002-A; (2) full browser session — logging into BAIS as that employer now renders `PrincipalCaseWorkspace` (the correct 41-question employer/LCA checklist, showing the earlier test answer as "Under review"), not the 78-question employee checklist.

---

## 2. A second real bug found investigating C1: InvitePanel always shows "Invited"

Not in F-2's list — found while trying to actually invite an employee to test the fix. `BAIS/Frontend/src/components/questionnaire/InvitePanel.jsx` line 15:
```js
const invited = Boolean(child.clientEmail);
```
Because `createCase` spread the employer's own `clientEmail`/`clientName` onto every child case at creation (same `commonCaseData` object, no override), `child.clientEmail` was truthy from the moment of creation — before any real employee was ever invited. The panel permanently showed a green "Invited" badge with the employer's own email, and the actual "enter name + email, Send Invite" form could never render.

**Fix applied** (same file, child-case creation block): override `clientEmail: ""`, `clientName: ""` on child cases at creation, leaving `user` untouched (still legitimately shared with the employer pre-invite, per §1).

**Verified live**: called the real `POST /api/cases/:principalId/invite-employee` endpoint as the B003 employer for a real new email (`priya.nair@f3tech.example.com`); the child case's `user` transferred to a genuinely new, separate `User` document with `role: "employee"`, `clientEmail`/`clientName` set correctly — the mechanism itself was already correct, only the frontend's "is this already invited" check was broken.

---

## 3. M4 — reinvestigated: F-3's guess of ~24 questions needing `mapping.canonicalPath` was also wrong

Loaded `i129-h1b-crosswalk.js` directly: of 101 crosswalk entries, 84 use `source: "raw.questionnaireAnswers.<questionKey>.value"` — resolved by literal question key, independent of `question.mapping` entirely (confirmed by successfully running the codebase's own pre-existing `h1b-golden-path.test.js`, which populates exactly these fields with no mapping set and passes). Only **17 unique canonical paths** in the crosswalk use the `person.*`/`contact.*`/`company.*`/`immigration.*` namespace that actually depends on `question.mapping.canonicalPath`. Cross-referencing against the live DB found **16 of those 17 already wired** (14 on `h1b_employee_checklist` questions set by a prior session, 2 resolved directly from the `Case`/`User` documents, no `Question.mapping` involved at all).

**The one real gap:** `company.name`, needed on I-129 `#subform[0]` and `#subform[13]` (petitioner name, 2 occurrences), had no route to canonical data — `employer_company_fullName`'s `mapping.canonicalPath` was unset, and `CanonicalBuilderService`'s only fallback (`QUESTION_KEY_MAP`) keys on unnamespaced strings like `"fullName"`, which never matches a namespaced key like `employer_company_fullName`.

**Fix applied:** `Backend/scripts/f3-wire-question-canonical-paths.js` — sets `mapping.canonicalPath = "company.name"` on `employer_company_fullName`. Idempotent, run once, verified.

**This fix is real but insufficient on its own** — see §5.

---

## 4. Real workflow execution (Part D) — how far it got

A fresh case was created via the real `POST /api/cases` endpoint (same code path a staff "Create Case" click hits) — **B003** (principal/employer, `f3employer@test.corp`) / **B003-A** (child, invited separately as `priya.nair@f3tech.example.com`, a genuinely distinct account per §2). Driven entirely through the real BAIS UI (Playwright driving the actual Chromium-rendered app, not API calls, for every questionnaire answer):

- **Employer checklist**: all 20 required fields filled (company info, signing person, position/LCA, workforce counts, radios) + all 4 required documents uploaded (business license, articles of incorporation, company letterhead, certified LCA). `Case.questionnaireReferences` for `targetRole: "employer"` is now **`"completed"`** — the first time any real case in this database has reached that state.
- **Employee checklist** (separate login, separate account): all required fields filled (personal identity, passport, gender, education, immigration history, filing type) + required documents uploaded (resume, passport, I-94). 30 real `Answer` documents now exist for B003-A (compare: B001-A/B002-A, the two "real" test cases audited in F-2, still have **zero**).
- **Chain verification** (`f2-chain-verify.js` re-run against B003/B003-A, canonical-snapshot mode): **69 / 101 crosswalk fields now resolve to a real canonical value**, up from 14/101 in F-2's audit of the contaminated B002 case. This is a direct, measurable result of real answers + the M4 fix.
- **Generate USCIS Forms**: still blocked. See §5 — not by a questionnaire-completeness gap this time, but by two deeper issues.

---

## 5. Two new CRITICAL findings — deeper than anything F-2 found, out of F-3's original scope

### N1 — Questionnaire file-answers never create a real `Document` record

`questionnaireService.saveFileAnswer` (`Backend/src/modules/questionnaires/questionnaire.service.js:1332`) writes uploaded files only into `Answer.files` — grepped the whole function body: no `Document.create` call anywhere. Confirmed live: after uploading all 6 required documents (4 employer + 2 employee) through the real checklist UI, `Document.countDocuments({caseId: B003._id})` and `{caseId: B003-A._id}` both return **0**.

But `CaseLifecycleOrchestrator.metrics()`'s `documentsComplete`/`documentsReviewed` gates (the ones `generateForms` checks before allowing form generation) read from the **`Document` collection**, joined against `Case.checklistItems`/`documentChecklist` — never from `Answer.files`. These are two disconnected storage systems. The questionnaire checklist UI is the *only* document-upload surface reachable from a real client session in this codebase (grepped for other upload call sites in `Documents.jsx`/`CaseRoleChecklist.jsx` — none found), and it feeds a system the readiness gate never looks at.

**Consequence:** no case, real or synthetic, can ever satisfy `documentsComplete` by uploading its required documents through the actual client-facing checklist UI. This is very likely the deepest true explanation for "0 CaseForms have ever existed in this database" — deeper than F-2's own explanation (missing Answer records), since B003/B003-A now has real, complete Answer records including files, and still cannot pass this gate.

**Not fixed in this session** — reconciling two storage systems (should file-question answers *also* create a `Document` record? should the readiness gate read `Answer.files` too? does OCR/document-intelligence indexing, which is keyed off real `Document` records, need to run either way?) is a real design decision, not a mechanical patch, and belongs in a scoped follow-up rather than a rushed fix inside F-3.

### N2 — `CanonicalBuilderService.build()` discards merged `company.*` data

Even with N4's `company.name` mapping fix in place and a real, saved `employer_company_fullName` answer, `company.name` still failed to resolve in the re-run chain-verify (2/2 occurrences unresolved). Traced directly: `CanonicalBuilderService.js:407`
```js
merged.profile.company = rawCollections.company;
```
unconditionally overwrites whatever the merge step computed for the `company.*` namespace (from the correctly-mapped questionnaire answer) with `rawCollections.company` — built from the case's linked `Company` model document, which is `null`/empty for every case in this employer/employee (Phase 9) architecture, since that architecture uses `EmployerProfile`, not the older `Company` model. Confirmed directly: `CanonicalBuilderService.build(B003principalId).profile.company` returns `{}`.

**Consequence:** `company.name` — needed on 2 of the I-129's petitioner-identity fields — can never resolve correctly for any employer/employee-structure case, regardless of any question-mapping fix, until this overwrite is corrected (e.g., merge `rawCollections.company` onto the already-merged candidates instead of replacing them, or skip the overwrite when `rawCollections.company` is empty).

**Not fixed in this session** — same reasoning as N1: this is core canonical-assembly logic shared by every visa type and case structure in the platform; changing it deserves its own focused, carefully-tested pass, not a same-session patch bolted onto F-3's already-large diff.

---

## 6. What F-3 certifies, honestly

| F-3 success criterion | Result |
|---|---|
| Real case driven through BAIS + INSZoom, no direct DB manipulation of case/questionnaire data | **Achieved for both questionnaires.** Employer and employee checklists both fully completed through the real UI on a fresh case (B003/B003-A), including the real invite-employee flow producing a genuinely separate employee account. |
| Generate USCIS Forms → 200 | **Not reached.** Blocked by N1 (documents gate reads a collection the checklist UI never populates), independent of questionnaire completeness. |
| CaseForm exists with fieldValues populated | Not reached (blocked by the above). |
| f2-chain-verify.js ≥ 90% primary field match | **Not measurable yet** (no CaseForm to compare against), but the canonical-resolution precondition improved from 14/101 to 69/101 real fields, and N2 identifies the specific remaining defect for `company.name`'s 2 occurrences. |
| F-1 native PDF editor live verification | Still blocked — same as F-1 and F-2 left it (needs a CaseForm to exist first). |

**Fixes shipped and verified this session:**
1. `getMyCase` case-resolution fix (C1's real root cause) — `Backend/src/modules/cases/case.controller.js`.
2. Child-case `clientEmail`/`clientName` blanking (fixes `InvitePanel`'s permanent false "Invited" state) — same file.
3. Child-case `checklistItems`/`documentChecklist` role-filtering (M2, carried over from F-2's finding) — same file, `filterChecklistForRole`.
4. `employer_company_fullName` → `company.name` canonical mapping (M4's one real gap) — `Backend/scripts/f3-wire-question-canonical-paths.js`.

**New findings for a follow-up phase (F-4), in priority order:**
1. **N1** (critical) — reconcile `Answer.files` vs. the `Document` collection so a real document upload through the checklist UI can ever satisfy `documentsComplete`.
2. **N2** (critical) — fix `CanonicalBuilderService.build()`'s `company` namespace overwrite so mapped questionnaire answers for `company.*` aren't discarded.
3. Re-run `f2-chain-verify.js` against B003/B003-A once N1/N2 are fixed and Generate Forms succeeds — that will be the first genuine MATCH/MISMATCH/MISSING certification against a real, UI-driven case.
4. F-3's original L1 (stale `e2e/uscis-form-render.spec.js` case IDs) and L2 (stale Phase 5 report annotation) were not reached this session — still open.

**Test artifacts:** B003/B003-A (real, complete employer + employee questionnaires) are left in the dev database intentionally as the reference case for the F-4 follow-up — do not delete. Temporary passwords were set on two obviously-synthetic dev/test accounts (`admin@inszoom.com`, `f3employer@test.corp`, and the newly-created `priya.nair@f3tech.example.com`) to drive this session's UI testing; none are real customer accounts.
