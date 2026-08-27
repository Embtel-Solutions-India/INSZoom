# PHASE 7 COMPLETION REPORT — Team Lead Queue and Case Assignment
**Date:** 2026-08-27
**Status:** COMPLETE
**Verdict:** PHASE 7 COMPLETE — READY FOR PHASE 8

---

## Summary

Phase 7 added cascade-to-children assignment logic and per-child override tracking to the Case model's existing, already-production-grade assignment endpoints, added `caseRole` filtering so child cases can never surface as independent items in a pending-assignment queue, and extended the existing unified INSZoom cases UI (`/crm-cases`, `/crm-cases/:id`) with a Pending Assignment panel, a Team Lead assignment option, and child/parent case visibility. As in Phase 6, investigation found the spec's assumptions about what existed were substantially wrong — `assignCaseManager`, `assignTeamLead`, full audit trail, messaging resync, and notification/email dispatch were already built and tested — so Phase 7 extended that system instead of building a parallel one. All static verification passed; live-DB testing is still pending and requires a human smoke test.

---

## Architecture Decisions: Existing System Extended, Not Duplicated

**Why no new `/assign` / `/assign-override` endpoints were created:**
The spec's Deliverable 1 asked for `POST /api/cases/:principalId/assign` and `POST /api/cases/:caseId/assign-override`. Investigation found `PUT /api/cases/:id/assign-case-manager` and `PUT /api/cases/:id/assign-team-lead` already existed, fully wired to `CaseAssignmentEvent` audit records, `assignmentHistory[]`, messaging conversation resync, in-app + realtime notifications, and (for case managers) an already-registered `case-assigned-case-manager` email template. These endpoints operate on any case by id — assigning a principal case and assigning a child case directly are both just calls to the same endpoint with a different target id. Phase 7 therefore extended these two functions rather than adding a duplicate pair:
- Calling them on a **principal** case now cascades the same assignment to all child cases where `assignmentOverridden !== true`.
- Calling them on a **child** case (`caseRole` `employee`/`beneficiary`) directly now automatically sets `assignmentOverridden = true` on that child — this *is* the "assign-override" behavior from the spec, achieved with zero new routes.

**Why no new `/team-lead/cases`, `/case-manager/cases`, `/admin/cases` routes were created:**
INSZoom already has a single unified case list (`/crm-cases`) and detail page (`/crm-cases/:id`) that every staff role uses, with role-based visibility already enforced server-side by `case.service.js`'s `applyCaseRoleFilter` (team leads see their team/assigned cases, case managers see their assigned cases, admins see everything). Building three separate role-specific page trees would have duplicated this working, tested scoping logic and fragmented case detail features (documents, messaging, forms, payments, addons — all already built into `CRMCaseDetail.jsx`) across multiple new pages. Phase 7 instead added a **Pending Assignment panel** to the top of the existing `/crm-cases` page (visible only to `super_admin`/`admin`/`team_lead`) and extended the existing detail page with child/parent case visibility.

**Why no new user-listing or case-assigned-email endpoint was created:**
`GET /api/users/assignable?role=<role>` (team-scoped for team leads) and the `case-assigned-case-manager` email template already existed and were already wired into the assignment flow. Phase 7 only added a thin `usersApi.assignable()` frontend wrapper around the former; neither needed backend changes.

---

## Deliverable 1 — Backend: Cascade and Queue Filtering

### `caseRole` / `caseStructure` query filtering (`case.service.js`)

`buildCaseFilterFields` (used by `GET /api/cases` and, transitively, every dashboard query) now accepts:
```js
if (query.caseRole) {
  const roles = String(query.caseRole).split(",").map((r) => r.trim()).filter(Boolean);
  if (roles.length) filter.caseRole = roles.length > 1 ? { $in: roles } : roles[0];
}
if (query.caseStructure) filter.caseStructure = query.caseStructure;
```
This did not exist before Phase 7 — confirmed by reading the function prior to editing it; no `caseRole` filter existed anywhere in `case.service.js`.

### Pending-assignment queue excludes children (Invariant 1)

`GET /api/cases/dashboard/team-lead` (`getTeamLeadDashboard`, unchanged route/path/middleware) now scopes its `unassignedCases` and `agingCases` queries with:
```js
const queueRoleFilter = { caseRole: { $in: ["principal", "single"] } };
```
applied to both `Case.find(...)` (unassigned cases list) and the aging-cases count. `priorityCases`/`assignedCases`/`caseManagerWorkload` were left unchanged — those aren't the "pending assignment queue" the invariant governs.

### Cascade logic (`case.controller.js`)

New helper, placed alongside the existing `recordReassignment`/`notifyAssignee` helpers:
```js
async function cascadeAssignmentToChildren(principalCase, fieldSet) {
  const childFilter = { parentCase: principalCase._id, assignmentOverridden: { $ne: true } };
  const [pendingResult, otherResult] = await Promise.all([
    Case.updateMany(
      { ...childFilter, status: "pending_assignment" },
      { $set: { ...fieldSet, status: "assigned", "workflow.status": "assigned" } }
    ),
    Case.updateMany({ ...childFilter, status: { $ne: "pending_assignment" } }, { $set: fieldSet }),
  ]);
  return (pendingResult.modifiedCount || 0) + (otherResult.modifiedCount || 0);
}
```
Two `updateMany` calls (not a single aggregation-pipeline update) so the conditional `pending_assignment → assigned` transition doesn't depend on MongoDB 4.2+ pipeline-update support, and so no other status is ever touched by a reassignment — matching the spec's "Phase 7 only transitions Cases from `pending_assignment` to `assigned`. It does not touch any other status transition."

**Wired into `assignCaseManager`** (cascades `{ assignedCaseManager, primaryOwner }`) **and `assignTeamLead`** (cascades `{ assignedTeamLead }`), in both cases:
- Only when `caseData.caseRole === "principal"` (single cases have `childCaseCount: 0` by construction, so cascading on them is intentionally skipped rather than issuing a guaranteed-empty query).
- Only after the principal's own `caseData.save()` has already committed.
- Wrapped in `.catch()` — a cascade failure is logged and returns `0`, never fails or rolls back the principal's own already-committed assignment (Invariant 5).
- Both endpoints now return `childrenCascaded` (a count) in their JSON response — purely additive, does not change the existing response shape for any current consumer.

**Override flag set automatically on direct child assignment** — added to both `assignCaseManager` and `assignTeamLead`, immediately before `caseData.save()`:
```js
if (["employee", "beneficiary"].includes(caseData.caseRole)) {
  caseData.assignmentOverridden = true;
}
```
This satisfies Invariant 3 by construction: the write only ever touches `caseData` itself (the one child case being saved) — no sibling or principal document is queried or modified in this code path.

### Children data enriched for the UI (`case.service.js`)

`getRelatedRecords` (backing `GET /api/cases/:id/related`, an existing endpoint, unchanged route) now selects and populates additional fields on the `childCases` it returns:
```js
Case.find({ parentCase: caseId })
  .select("caseNumber clientName visaType status stage caseRole childIndex assignedCaseManager assignmentOverridden")
  .populate("assignedCaseManager", "name displayName email")
  .sort({ childIndex: 1, createdAt: 1 })
```
Previously this only selected `caseNumber clientName visaType status stage` — insufficient for a UI that needs to show who's assigned to each child and whether that assignment is overridden. This is additive (more fields, not fewer) so no existing consumer of `getRelatedRecords` breaks.

### Invariant 4 verification: `caseNumber` never used for DB relationships

Every new/modified query in this phase uses `parentCase` (ObjectId) for parent-child relationships — `Case.find({ parentCase: caseId })`, `Case.updateMany({ parentCase: principalCase._id, ... })`. `caseNumber` appears in Phase 7's diff only as a `.select(...)` projection field or in response/display strings, never as a query filter or as a string that gets parsed/split. Confirmed by grep across the full diff of `case.controller.js` and `case.service.js`.

---

## Deliverable 2 — INSZoom Frontend: Pending Assignment Queue

**File:** `INSZoom/frontend/src/pages/CRMCases.jsx` (extended, not replaced — this is the existing unified cases page, at route `/crm-cases`)

Added a `PENDING_QUEUE_ROLES = ['super_admin', 'admin', 'team_lead']`-gated panel at the top of the page, sourced from `casesApi.getTeamLeadDashboard()` (new wrapper, existing endpoint) — its `unassignedCases` list, which is now `caseRole`-filtered server-side (see Deliverable 1), so it never contains a child case. Each row shows case number, client name, visa type, and an "Assign Case Manager" button that reuses the page's pre-existing deep-link pattern (`navigate('/crm-cases/:id?assign=case_manager')`, which `CRMCaseDetail.jsx` already auto-opens the Assign Staff modal from). The panel refetches on the same `case:assigned` socket event the rest of the page already listens for.

---

## Deliverable 3 & 4 — INSZoom Frontend: Matter / Child Case Visibility

**File:** `INSZoom/frontend/src/pages/CRMCaseDetail.jsx` (extended — this single page now serves what the spec called the "Principal Case Detail Page" and "Individual Child Case Detail Page," since both are the same underlying case-detail component)

- When `caseData.caseRole === 'principal'` and `caseData.childCaseCount > 0`: a "Child Cases" table renders below the header, fetched via `casesApi.getRelated(id)` (new wrapper, existing endpoint, now returning the enriched fields from Deliverable 1). Each row shows case number, client name (falls back to "TBD" when not yet set — per the spec's own Q6, this is expected before the employee-invitation flow populates it), status, assigned case manager, an "Overridden" badge when `assignmentOverridden` is true, and a "View →" link to that child's own `/crm-cases/:childId` page.
- When `caseData.caseRole` is `employee`/`beneficiary`: a "Part of matter" banner renders, using `caseData.parentCase` — already populated by the existing `GET /cases/:id` endpoint's `populateCaseQuery` (no new fetch needed), with a "View matter →" link back to the principal. This is the spec's breadcrumb requirement, implemented as a link rather than a literal three-level breadcrumb bar, since child and principal cases share one page component rather than living at separate routes.

---

## Deliverable 5 — INSZoom Frontend: Assign Staff Modal Extended

**File:** `INSZoom/frontend/src/pages/CRMCaseDetail.jsx`

The existing Assign Staff modal (previously hardcoded to a single `case_manager` role option, confirmed by reading the file before editing) now:
- Offers a `team_lead` option in the Role `<select>`.
- `getFilteredUsers()` gained a `team_lead` branch (`users.filter(u => u.role === 'team_lead')`); the existing `fetchUsers()` call (`GET /users/assignable`, no role param) already returns team leads, since `ASSIGNABLE_ROLES` in `user.service.js` includes `"team_lead"` — confirmed by reading that constant, no backend change needed.
- `handleAssign` gained a `team_lead` branch calling the new `casesApi.assignTeamLead(id, assigneeId, notes)` wrapper (`PUT /cases/:id/assign-team-lead`, existing route).
- Shows a note ("This will also apply to every child case in this matter, except any already individually overridden") whenever the case being assigned is a principal, and surfaces the response's `childrenCascaded` count in a confirmation alert after a successful assignment — matching the existing `alert()` pattern already used elsewhere in this codebase (e.g. `CreateCaseModal`'s `handleCaseCreated`).

There is no separate `AdminCasesPage.jsx` / `CaseManagerCasesPage.jsx` — the existing `/crm-cases` page already serves admin, team lead, and case manager roles via server-side scoping (see Architecture Decisions above), so no `creationSource` badge work was needed beyond what already exists; `creationSource` is already stored on every Case from Phase 5 and was not touched.

---

## Verification Results

| Check | Result |
|-------|--------|
| `node --check` on all modified backend files | PASS |
| `require('./src/app.js')` loads cleanly (full app boot, no live DB needed) | PASS |
| `npm run build` in INSZoom frontend | PASS (`CRMCaseDetail` bundle grew 94.05 kB → 98.10 kB, `CRMCases` grew 15.68 kB → 17.42 kB, reflecting the new code) |
| Route registration: cascade/override logic added with zero new routes | Confirmed — `case.routes.js` unchanged by Phase 7; `assign-case-manager`, `assign-team-lead`, `dashboard/team-lead`, `:id/related` all pre-existing, same paths/middleware |
| grep `caseNumber` used as a DB relationship query field in Phase 7 code | ZERO results — PASS (projection/display only) |
| grep string-splitting on `caseNumber` (e.g. `.split('-')`) anywhere in Phase 7 code | ZERO results — PASS |
| `POST /api/cases` (Phase 5) untouched | CONFIRMED |
| All Phase 6 lead endpoints (`/api/eligibility-quiz/leads/*`) untouched | CONFIRMED |
| `BAIS/Frontend/` untouched | CONFIRMED |
| Auth middleware, JWT structure | untouched — CONFIRMED |
| Live DB assignment/cascade tests | PENDING — requires human smoke test (no reachable MongoDB instance or mongodb-memory-server in this environment) |

---

## Pending Human Verification

The following must be confirmed manually against a real MongoDB instance before Phase 8 begins:

1. Assigning a principal case's case manager cascades `assignedCaseManager` + `primaryOwner` to all its children, and transitions each child's `status` from `pending_assignment` to `assigned` (children in any other status keep that status).
2. A child case with `assignmentOverridden: true` is skipped by a subsequent principal-level (re)assignment — its `assignedCaseManager` stays whatever it was overridden to.
3. Assigning a case manager directly to a child case (navigating to its own `/crm-cases/:childId` page and using Assign Staff there) sets `assignmentOverridden: true` on that child only — sibling children and the principal are unchanged.
4. `GET /api/cases/dashboard/team-lead`'s `unassignedCases` never includes a case with `caseRole` `employee`/`beneficiary`, even when such a case has no `assignedCaseManager`.
5. The Pending Assignment panel on `/crm-cases` renders only for `super_admin`/`admin`/`team_lead`, is empty/absent for `case_manager`, and its "Assign Case Manager" action correctly deep-links into the existing assign flow.
6. The Child Cases table on a principal's detail page and the "Part of matter" banner on a child's detail page both render correctly and link to the right case.
7. `case-assigned-case-manager` email still fires exactly once per assignment action (not once per cascaded child) — confirm no email/notification spam was introduced by the cascade.

---

## Files Modified

1. `Backend/src/modules/cases/case.service.js` — added `caseRole`/`caseStructure` filter support to `buildCaseFilterFields`; enriched `getRelatedRecords`'s child-case projection/population
2. `Backend/src/modules/cases/case.controller.js` — added `cascadeAssignmentToChildren` helper; wired cascade + auto-override-flag logic into `assignCaseManager` and `assignTeamLead`; added `caseRole` scoping to `getTeamLeadDashboard`'s pending-queue queries
3. `INSZoom/frontend/src/services/api.js` — added `casesApi.assignTeamLead`, `casesApi.getRelated`, `casesApi.getTeamLeadDashboard`, `usersApi.assignable`
4. `INSZoom/frontend/src/pages/CRMCases.jsx` — added the Pending Assignment queue panel and its fetch/refresh logic
5. `INSZoom/frontend/src/pages/CRMCaseDetail.jsx` — added Child Cases table, "Part of matter" banner, Team Lead role option in the Assign Staff modal, and cascade-aware `handleAssign`/`getFilteredUsers`

## Files Created

None — Phase 7 required no new files (unlike Phase 6, which needed two new email templates).

## Files Read

`PHASE_5_COMPLETION_REPORT.md`, `PHASE_2_COMPLETION_REPORT.md`, `Backend/src/models/Case.js`, `Backend/src/modules/cases/case.routes.js`, `Backend/src/modules/cases/case.controller.js`, `Backend/src/modules/cases/case.service.js`, `Backend/src/models/User.js`, `Backend/src/modules/authorization/roleHierarchy.js`, `Backend/src/modules/users/user.routes.js`, `Backend/src/modules/users/user.service.js`, `Backend/src/modules/users/user.controller.js`, `Backend/src/modules/notifications/notification.service.js`, `Backend/src/modules/email/email.service.js`, `Backend/src/modules/email/templates/case-assigned-case-manager.js`, `INSZoom/frontend/src/App.jsx`, `INSZoom/frontend/src/pages/CRMCases.jsx`, `INSZoom/frontend/src/pages/CRMCaseDetail.jsx`, `INSZoom/frontend/src/pages/CaseManagers.jsx`, `INSZoom/frontend/src/pages/CaseManagerDetails.jsx`, `INSZoom/frontend/src/services/api.js`, `INSZoom/frontend/src/utils/permissions.js`, `INSZoom/frontend/src/contexts/AuthContext.jsx`, `INSZoom/frontend/src/components/CreateCaseModal.jsx`

---

## Unchanged Files Confirmed

- `POST /api/cases` handler (`Backend/src/modules/cases/case.controller.js`'s `createCase`) — untouched
- `Backend/src/modules/cases/case.routes.js` — untouched (no new routes needed)
- All Phase 6 lead endpoints (`Backend/src/modules/eligibility-quiz/`) — untouched
- All files in `BAIS/Frontend/` — untouched
- Auth middleware and JWT structure — untouched
- AutoFillService, CanonicalSyncService, USCIS form mapping — untouched
- `GET /api/auth/session-context` (Phase 3) — untouched
