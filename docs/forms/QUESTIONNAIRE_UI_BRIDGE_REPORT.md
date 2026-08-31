# Questionnaire UI Bridge — caseRole=principal now uses the real card-based checklist
**Date:** 2026-08-28
**Status:** COMPLETE

---

## The bug

A real `caseRole: 'principal'` case (created via `POST /api/cases`) was rendering `Documents.jsx`'s Phase 9 branch — `PrincipalCaseWorkspace` → `CanonicalProfileForm` — instead of the mature, card-based `ChecklistItemRow` UI (FIELD/DOCUMENT badge, REQUIRED/OPTIONAL, status chip, OCR autofill) the rest of the app already uses. This was the exact architecture-fork risk flagged in the Phase 9 completion report: two independent employer/employee systems coexisted, and the newer one had a visibly worse UI.

## Why this was fixable without a deep rewrite

Investigation of the "old" system's actual code (not just its outward behavior) found it was already generic enough to support this:

- `Case.participants[]` (`case-participant.service.js`) is a plain embedded array searched by `role` + `userId`/`email` — **not** hardcoded to `employerUser`/`employeeUser` fields. Those fields are only a fallback (`participantAssignee`) when no participant record exists.
- `useQuestionnaireAnswers(caseId, targetRole)` (the frontend hook) already takes `caseId` as an explicit parameter — it has no built-in assumption that there's only one case in play.
- `saveAnswers`/`getQuestionnaireForCase` (`questionnaire.service.js`) key everything off `payload.caseId`/`caseId` directly: `Answer` documents carry `caseId` on each record, and `responseId` embeds it. Calling these with a **child Case's own `_id`** — instead of one shared case with two role fields — produces `Answer` records already correctly scoped to that one case, no cross-contamination possible.
- `canAccessCase` already grants the employer (`role: 'client'`, per Phase 5's stub-user creation) access to the principal case and every not-yet-invited child case via the generic `sameId(caseData.user, user._id)` check — no special-casing needed.

So the fix is: call the *existing* questionnaire APIs once per real Case document (principal for the employer/petitioner section, each child for its own employee/beneficiary section) instead of building a parallel data model. Per-case data isolation (Invariant 2 from Phase 9) falls out for free, and — as a direct side effect — `CanonicalBuilderService` (which reads `Answer.find({ caseId })`) now correctly receives this data per case, closing the "new architecture doesn't feed USCIS forms" gap the Phase 9 report flagged as unresolved.

## What changed

**New:** `BAIS/Frontend/src/components/questionnaire/CaseRoleChecklist.jsx` — renders one Case's one `targetRole` questionnaire through the real `ChecklistItemRow`/`QuestionInput`/`AutofillButton`/`PrefillBadge` stack (copied faithfully from `Documents.jsx`'s own existing render loop). Exports both a convenience wrapper (`CaseRoleChecklist`, calls the hook itself) and a presentational view (`CaseRoleChecklistView`, takes a pre-built `qa` object) so a caller that needs the same hook result for its own logic doesn't fetch twice.

**Rewritten:** `PrincipalCaseWorkspace.jsx` — the employer/petitioner section and each fill-self employee tab now render through `CaseRoleChecklist`/`CaseRoleChecklistView` (`targetRole: 'employer'|'petitioner'` on the principal's own `caseId`, `'employee'|'beneficiary'` on each child's own `caseId`) instead of `CanonicalProfileForm`. The data-entry-mode modal's gating condition ("has the employer started answering") now reads `useQuestionnaireAnswers`'s own `answers` object instead of `EmployerProfile.canonicalData`. `DataEntryModeModal`/`InvitePanel`/remove-employee are unchanged — they're genuinely new-architecture concerns (principal+children case trees) with no old-system equivalent.

**Rewritten (and narrowed):** `EmployeeSelfServiceView.jsx` — originally showed a read-only employer summary above the employee's own checklist. Investigation of `canAccessCase` found `employee`/`beneficiary` accounts go through `canAccessRestrictedChildCase`, a **deliberate** security boundary requiring `caseData.caseRole === user's own role` — i.e. an invited employee's account can never access the principal case, by design. This also matches the original spec more precisely: the "read-only employer summary" was specified for the *employer's own* fill-self tabs (who already has legitimate access to both), not for an invited employee's separate account. Removed the employer summary rather than working around a real security boundary; an invited employee now sees only their own checklist.

**Not changed:** `CanonicalProfileForm.jsx`, `canonicalFieldGroups.js`, `employerProfileApi`/`employeeProfileApi`, and the `Backend/src/modules/employer-profile/`+`employee-profile/` modules — `BAIS/Frontend/src/Pages/Dashboard/Profile.jsx` (modified by a separate, unrelated session) still calls `employeeProfileApi` directly, so none of this is dead code; it was left fully intact.

## Verification

| Check | Result |
|---|---|
| `npm run build` (BAIS frontend) | PASS |
| `npx eslint` on all 3 changed/created files | PASS, zero warnings |
| Backend boot (no backend files changed this pass) | PASS |
| `AutofillButton` prop signature matches usage | Confirmed (`documentType, caseId, disabled, onUploaded`) |
| `canAccessCase` access paths for employer (principal + fill-self children) | Confirmed via `sameId(caseData.user, user._id)`, no restricted-role gate applies to `role: 'client'` |
| `canAccessRestrictedChildCase` for an invited employee | Confirmed scoped to their own case only — the reason the employer read-only summary was removed rather than bridged |

## Pending Human Verification

1. Open a real `caseRole: 'principal'` H-1B case as the employer — confirm the employer section now renders as `ChecklistItemRow` cards (not the plain form from the screenshot), with the correct H-1B employer checklist content (the same one fixed in `QUESTIONNAIRE_SYSTEM_FIX_REPORT.md`).
2. Confirm the data-entry-mode modal still appears at the right time (after the employer has entered at least one answer, `dataEntryMode` still `not_set`).
3. Fill-self mode: confirm each employee tab renders the H-1B employee checklist correctly, and that Employee A's answers never appear on Employee B's tab.
4. Invite mode: invite an employee, log in as that new account, confirm they land on their own checklist only (no employer data visible).
5. Confirm OCR autofill buttons appear per section and correctly populate fields via the existing `handleAutofillResult` path.
6. After answering some employee questions, confirm `CanonicalBuilderService`/`GET /canonical/case/:childCaseId` (or the admin canonical-profile view) now shows that data — this is the closed USCIS-forms gap from Phase 9, worth confirming explicitly since it was previously a known limitation.

## Files Modified

1. `BAIS/Frontend/src/components/questionnaire/PrincipalCaseWorkspace.jsx`
2. `BAIS/Frontend/src/components/questionnaire/EmployeeSelfServiceView.jsx`

## Files Created

1. `BAIS/Frontend/src/components/questionnaire/CaseRoleChecklist.jsx`
2. `docs/forms/QUESTIONNAIRE_UI_BRIDGE_REPORT.md` (this file)

## Files Read (no changes)

`BAIS/Frontend/src/hooks/useQuestionnaireAnswers.js`, `BAIS/Frontend/src/hooks/useCaseQuestionnaire.js`, `BAIS/Frontend/src/Pages/Dashboard/Documents.jsx` (render-loop reference only), `Backend/src/modules/cases/case-participant.service.js`, `Backend/src/modules/cases/case.service.js` (`canAccessCase`/`canAccessRestrictedChildCase`), `Backend/src/modules/questionnaires/questionnaire.service.js` (`getQuestionnaireForCase`/`saveAnswers`), `BAIS/Frontend/src/Pages/Dashboard/Profile.jsx` (confirmed still uses `employeeProfileApi` — not touched)
