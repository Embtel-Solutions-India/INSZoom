# PHASE 6 COMPLETION REPORT — Admin Leads Page and Consultation Management
**Date:** 2026-08-27
**Status:** COMPLETE
**Verdict:** PHASE 6 COMPLETE — READY FOR PHASE 7

---

## Summary

Phase 6 added state-machine-enforced lead lifecycle transitions (confirm consultation, complete consultation, approve, reject) and wired a "Create Case" action into the INSZoom admin Leads page. The key architectural decision was to extend the existing `eligibility-quiz` leads module rather than build a parallel `/api/leads/*` module, because list/detail/status/notes endpoints and the `Leads.jsx` UI already existed there and worked. All static verification passed (syntax checks, full app load, frontend production build, invariant grep); live-DB transition testing against a real MongoDB instance is still pending and requires a human smoke test.

---

## Architecture Decision: Existing Module Extended

**Why the existing module was extended instead of creating new routes:**
Investigation prior to implementation found that `GET /leads`, `GET /leads/:id`, `POST /leads/:id/seen`, `PATCH /leads/:id/status`, `PATCH /leads/:id/assign`, and `POST /leads/:id/notes` already existed and were fully wired to a working frontend (`INSZoom/frontend/src/pages/Leads.jsx`) — just mounted under `/api/eligibility-quiz/leads/*` instead of `/api/leads/*`. `Backend/src/modules/leads/` (the module the original Phase 6 prompt assumed would hold these) only ever contained the Phase 4 lead-*creation* endpoints (`POST /public`, `POST /`, `POST /from-intake`) and never had GET/PATCH routes. Building a second, duplicate set of list/detail/status endpoints under `/api/leads/*` would have created two conflicting lead-management surfaces reading and writing the same `Lead` model. The instruction to "check before creating duplicates" required extending the module that already worked instead.

**Correct endpoint prefix for all Phase 6 lead transition routes:**
`/api/eligibility-quiz/leads/:id/{confirm-consultation,complete-consultation,approve,reject}`

This is important for Phase 7 and beyond — these routes live under the eligibility-quiz module, not the leads module. `Backend/src/modules/leads/` was not modified during Phase 6.

---

## Deliverable 1 — Backend: New Transition Endpoints

### New routes added to quiz.routes.js

| Method | Path | Middleware | Controller Function |
|--------|------|------------|---------------------|
| PATCH | /leads/:id/confirm-consultation | authenticate, authorizeRoles("super_admin","admin"), authorizePermissions("leads:update") | confirmConsultation |
| PATCH | /leads/:id/complete-consultation | authenticate, authorizeRoles("super_admin","admin"), authorizePermissions("leads:update") | completeConsultation |
| PATCH | /leads/:id/approve | authenticate, authorizeRoles("super_admin","admin"), authorizePermissions("leads:update") | approveLead |
| PATCH | /leads/:id/reject | authenticate, authorizeRoles("super_admin","admin"), authorizePermissions("leads:update") | rejectLead |

(`staffRoles = ["super_admin", "admin"]`, spread via `authorizeRoles(...staffRoles)` — the same constant and pattern already used by every other route in this file.)

### State machine enforcement

Each transition (`Backend/src/modules/eligibility-quiz/quiz.service.js`) validates `lead.status` against an allowed-from list before mutating, via a shared `invalidTransitionError(fromStatus, action)` helper. Invalid transitions return HTTP 409 with `code: "INVALID_TRANSITION"` and a message naming the current status.

| Transition | Allowed From | New Status |
|-----------|--------------|------------|
| confirm-consultation | new, booked | consultation_confirmed |
| complete-consultation | consultation_confirmed | consultation_completed |
| approve | consultation_completed | approved |
| reject | consultation_confirmed, consultation_completed | rejected |

Each transition also writes an audit event via `audit.service.recordAuditEvent` (actions: `lead.consultation_confirm`, `lead.consultation_complete`, `lead.approve`, `lead.reject`), matching the existing pattern used by `updateLeadStatus`/`assignLead`/`addLeadNote` in the same file. The pre-existing `PATCH /leads/:id/status` endpoint (`updateLeadStatus`) was left untouched as a freeform, unrestricted admin override — it does not enforce this state machine and was not intended to.

### Critical invariant: approveLead contains no Case creation

Verified by reading the full function body (`quiz.service.js` lines 301–326): zero occurrences of `Case.create(` or `new Case(` inside `approveLead`. The only appearances of the word "case" in the function are in user-facing notification/email text ("ready for case creation", "ready to convert to a case"). `approveLead` only sets `lead.status = "approved"` and populates `lead.approval.{approvedAt,approvedBy}`.

---

## Deliverable 2 — Backend: Notifications and Email

### New email templates created
- `Backend/src/modules/email/templates/lead-approved.js`
- `Backend/src/modules/email/templates/lead-rejected.js`

Both follow the existing template contract exactly (`module.exports = { key, subject, bodyLines }`), matching the pattern of `consultation-confirmation.js` and every other file in that directory.

### Registration confirmed
- Both templates registered in `Backend/src/modules/email/email.service.js`'s `TEMPLATES` map (lines 23–24): `"lead-approved": require("./templates/lead-approved")`, `"lead-rejected": require("./templates/lead-rejected")`.
- `"lead_approved"` added to the notification type enum. **Correction to this report's own instructions:** the enum (`NOTIFICATION_TYPES`) lives in `Backend/src/modules/notifications/notification.constants.js`, not `notification.service.js` — `notification.service.js` only imports it (transitively, via the `Notification` model). It was added there under a new `// ── Phase 6 lead lifecycle (eligibility-quiz/quiz.service.js) ──` comment block, alongside the existing `lead_created`/`consultation_booked` entries from the Phase 1 funnel. No `category` value was set on the `lead_approved` notification call — it defaults to `"general"`, matching how the existing `lead_created` notification (in `Backend/src/modules/leads/lead.service.js`) is already sent.

---

## Deliverable 3 — INSZoom Frontend: leadsApi Extensions

**File:** `INSZoom/frontend/src/services/api.js`

New functions added to `leadsApi` (lines 295–300):
```js
confirmConsultation: (id) => api.patch(`/eligibility-quiz/leads/${id}/confirm-consultation`, {}),
completeConsultation: (id, notes) => api.patch(`/eligibility-quiz/leads/${id}/complete-consultation`, { notes }),
approve: (id) => api.patch(`/eligibility-quiz/leads/${id}/approve`, {}),
reject: (id, rejectionReason) => api.patch(`/eligibility-quiz/leads/${id}/reject`, { rejectionReason }),
```
These follow the exact axios-wrapper pattern already used by `list`, `get`, `markSeen`, `updateStatus`, and `addNote` in the same object — all calls resolve to `response.data`, errors are read via `error.response?.data`.

---

## Deliverable 4 — INSZoom Frontend: Leads.jsx Action Buttons

**File:** `INSZoom/frontend/src/pages/Leads.jsx`

Status-appropriate action buttons now appear in the `LeadDrawer`'s "Case pipeline" section per the state machine:
- `new` / `booked` → "Confirm Consultation" button
- `consultation_confirmed` → "Mark Completed" + "Reject" buttons
- `consultation_completed` → "Approve" + "Reject" buttons
- `approved` → "Create Case" button
- `converted` → read-only text: "This lead has been converted to a case."
- `rejected` → read-only text showing `lead.approval.rejectionReason` if present

The pre-existing freeform status `<select>` (the 5 legacy statuses: new/contacted/booked/converted/closed) is now only rendered when `lead.status` is one of those 5 values; once a lead enters a Phase 6 lifecycle-only status (`consultation_confirmed`, `consultation_completed`, `approved`, `rejected`), the drawer shows a read-only status badge instead, so the dropdown can never desync from or bypass the enforced state machine.

Action calls run through a shared `runLeadAction` helper that surfaces `error.response?.data?.message` (e.g. an `INVALID_TRANSITION` 409) in an inline red banner above the action buttons, and disables all buttons while a request is in flight.

### Create Case button behavior (approved leads)

When admin clicks "Create Case" on an approved lead, `Leads.jsx` renders the existing `CreateCaseModal` (unmodified — its props already fully supported this use case):
```jsx
<CreateCaseModal
  onClose={() => setShowCreateCase(false)}
  onCreated={handleCaseCreated}
  leadId={selectedLead._id}
  creationSource="lead_conversion"
  initialData={{
    clientName: selectedLead.fullName,
    clientEmail: selectedLead.email,
    clientPhone: selectedLead.phone,
    visaType: selectedLead.visaPathway,
  }}
/>
```
`visaType` is sourced from `lead.visaPathway` (the field the eligibility-quiz funnel actually populates on every Lead document) rather than `visaInterest`, which exists on the schema but is not populated by this funnel. `CreateCaseModal.normalizeInitialVisaType` matches this against its `VISA_TYPE_OPTIONS` by value or label case-insensitively; if there's no match the visa field is simply left blank for the admin to pick manually — no error is thrown.

`handleCaseCreated` closes the modal, shows a confirmation alert (matching the existing `alert()` pattern already used in `CRMCases.jsx`'s own `handleCaseCreated`), and re-fetches the lead list so the now-`converted` status reflects immediately.

### Phase 5 side effect confirmed working

`POST /api/cases` with `creationSource="lead_conversion"` already sets `Lead.status = "converted"` and `Lead.convertedCaseId` in the current code (`Backend/src/modules/cases/case.controller.js`, inside `exports.createCase`):
```js
if (creationSource === "lead_conversion" && sourceLead) {
  sourceLead.status = "converted";
  sourceLead.convertedCaseId = principalCase._id;
  await sourceLead.save();
}
```
This was confirmed by reading the actual handler in the working tree. **The `PHASE_5_COMPLETION_REPORT.md` on disk is stale and incorrect on this point** — its own verdict section states "PHASE 5 IS NOT COMPLETE... implementation was intentionally paused before touching source files," but `case.controller.js` in the current working tree contains the full implementation the report describes as merely planned, including this exact Lead-conversion block, a 404 `LEAD_NOT_FOUND` guard, and a 409 `LEAD_ALREADY_CONVERTED` guard against double-conversion. Phase 6 did not need to duplicate any of this — it only needed to call `POST /api/cases` with the right payload, which `CreateCaseModal` already did.

---

## Verification Results

| Check | Result |
|-------|--------|
| `node --check` on all modified/created backend files | PASS |
| `require('./src/app.js')` loads cleanly (full app boot, no live DB needed) | PASS |
| `npm run build` in INSZoom frontend | PASS (Leads.jsx bundle grew from ~5 kB to 17.80 kB, reflecting the new code) |
| grep `Case.create`/`new Case(` in approveLead body | ZERO results — PASS |
| Route registration: mount point confirmed | `/api/eligibility-quiz` (via `Backend/src/routes/index.js` line 52 → `app.js` line 74 `app.use("/api", routes)`) |
| `POST /api/cases` untouched | CONFIRMED |
| `POST /api/leads`, `POST /api/leads/from-intake` untouched | CONFIRMED |
| `POST /consultation/book` untouched | CONFIRMED |
| `BAIS/Frontend/` untouched | CONFIRMED |
| Live DB transition tests | PENDING — requires human smoke test (no reachable MongoDB instance or mongodb-memory-server in this environment) |

---

## Pending Human Verification

The following must be confirmed manually against a real MongoDB instance before Phase 7 begins:

1. Full lifecycle: new → consultation_confirmed → consultation_completed → approved → Create Case → converted
2. Invalid transition blocked: attempting to approve a lead still in `new` status returns 409 with `code: "INVALID_TRANSITION"`
3. Reject path: consultation_confirmed → rejected, and that a rejected lead shows no further action buttons in the drawer
4. Email delivery (or at minimum `EmailLog` entries with `status: "skipped"` if no provider is configured) for `lead-approved` and `lead-rejected` on the approve/reject transitions
5. Notification fan-out to `super_admin`/`admin`/`team_lead` on approval

---

## Files Modified

1. `Backend/src/modules/eligibility-quiz/quiz.service.js` — added `confirmConsultation`, `completeConsultation`, `approveLead`, `rejectLead`, plus `invalidTransitionError` helper and top-level `emailService`/`notificationService` requires
2. `Backend/src/modules/eligibility-quiz/quiz.controller.js` — added controller wrappers for the four new service functions
3. `Backend/src/modules/eligibility-quiz/quiz.routes.js` — added the four new PATCH routes
4. `Backend/src/modules/email/email.service.js` — registered `lead-approved` and `lead-rejected` in `TEMPLATES`
5. `Backend/src/modules/notifications/notification.constants.js` — added `"lead_approved"` to `NOTIFICATION_TYPES`
6. `INSZoom/frontend/src/services/api.js` — added `confirmConsultation`, `completeConsultation`, `approve`, `reject` to `leadsApi`
7. `INSZoom/frontend/src/pages/Leads.jsx` — added `STATUS_LABELS`, extended `STATUS_COLORS`, added lifecycle action handlers (`runLeadAction`, `handleConfirmConsultation`, `handleCompleteConsultation`, `handleApprove`, `handleReject`, `handleCaseCreated`), added the "Case pipeline" action-button section and conditional `CreateCaseModal` render to `LeadDrawer`

## Files Created

1. `Backend/src/modules/email/templates/lead-approved.js`
2. `Backend/src/modules/email/templates/lead-rejected.js`

## Files Read

`PHASE_5_COMPLETION_REPORT.md`, `PHASE_4_COMPLETION_REPORT.md`, `Backend/src/models/Lead.js`, `Backend/src/modules/leads/lead.routes.js`, `Backend/src/modules/leads/lead.controller.js`, `Backend/src/modules/leads/lead.service.js`, `Backend/src/modules/eligibility-quiz/quiz.service.js`, `Backend/src/modules/eligibility-quiz/quiz.controller.js`, `Backend/src/modules/eligibility-quiz/quiz.routes.js`, `Backend/src/modules/notifications/notification.service.js`, `Backend/src/modules/notifications/notification.constants.js`, `Backend/src/modules/email/email.service.js`, `Backend/src/modules/email/templates/consultation-confirmation.js`, `Backend/src/modules/cases/case.controller.js`, `INSZoom/frontend/src/App.jsx`, `INSZoom/frontend/src/utils/permissions.js`, `INSZoom/frontend/src/services/api.js`, `INSZoom/frontend/src/components/CreateCaseModal.jsx`, `INSZoom/frontend/src/pages/Leads.jsx`, `INSZoom/frontend/src/pages/CaseManagers.jsx`, `INSZoom/frontend/src/pages/CRMCases.jsx`, `Backend/src/models/Notification.js`

---

## Unchanged Files Confirmed

- `POST /api/cases` handler (`Backend/src/modules/cases/case.controller.js`) — untouched
- `POST /api/leads`, `POST /api/leads/from-intake` (`Backend/src/modules/leads/`) — untouched
- `POST /consultation/book` — untouched
- All files in `BAIS/Frontend/` — untouched
- Auth middleware and JWT structure — untouched
- AutoFillService, CanonicalSyncService — untouched
