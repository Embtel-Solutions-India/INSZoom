# PHASE 5 COMPLETION REPORT - Case Creation Transaction
**Date:** 2026-08-27  
**Status:** Investigation complete through the pre-implementation gate. Implementation paused before code changes because the required rollback strategy conflicts with the no-hard-delete architectural invariant.

---

## Section 1 - Phase 5 Scope

Phase 5 is intended to replace the existing `POST /api/cases` handler with a staff-only case creation transaction and update the INSZoom Create Case UI to use that new endpoint.

The intended backend behavior is:

- Single-person visas create exactly one `Case`.
- Employer/employee visas create one principal `Case`, one `EmployerProfile`, N child `Case` documents, and N `EmployeeProfile` documents.
- Family visas create one principal `Case`, one child `Case`, and the required profile records.
- A stub client `User` is provisioned with a one-time setup token.
- Lifecycle work, notifications, realtime events, and email happen only after the create operation succeeds.
- `POST /api/cases/create-with-client` remains untouched.
- BAIS frontend remains untouched.

No implementation files were changed in this Phase 5 pass. Only this report was created.

---

## Section 2 - Investigation Completed

The mandatory Phase 5 investigation was completed through Step 10.

The root `Phase-5-Agent-Prompt.md` file was not present in the workspace. The Phase 5 prompt was available only as the attached markdown/pasted file, and the user confirmed that this was not a blocker. The master phase plan file `ImmigrationCRM-Complete-Phase-Plan.md` was also not present at the project root during this pass, so the investigation used the available Phase 1-4 completion reports plus the attached Phase 5 prompt.

Prior reports read:

- `PHASE_1_AUDIT_REPORT.md`
- `PHASE_2_COMPLETION_REPORT.md`
- `PHASE_3_COMPLETION_REPORT.md`
- `PHASE_4_COMPLETION_REPORT.md`

Backend files read:

- `Backend/src/models/Case.js`
- `Backend/src/modules/cases/case.constants.js`
- `Backend/src/models/EmployerProfile.js`
- `Backend/src/models/EmployeeProfile.js`
- `Backend/src/models/Counter.js`
- `Backend/src/services/CaseNumberService.js`
- `Backend/src/config/visaCategories.js`
- `Backend/src/config/visaTypes.js`
- `Backend/src/modules/cases/case.routes.js`
- `Backend/src/modules/cases/case.controller.js`
- `Backend/src/modules/cases/case.service.js`
- `Backend/src/modules/notifications/notification.service.js`
- `Backend/src/modules/notifications/notification.constants.js`
- `Backend/src/modules/notifications/notificationRules.js`
- `Backend/src/modules/email/email.service.js`
- `Backend/src/modules/email/templates/case-created-client.js`
- `Backend/src/modules/email/templates/case-created-team-lead.js`
- `Backend/src/modules/email/templates/client-portal-invitation.js`
- `Backend/src/modules/cases/case-lifecycle-orchestrator.service.js`
- `Backend/src/modules/auth/clientInvite.service.js`
- `Backend/src/modules/auth/password.service.js`
- `Backend/src/models/User.js`
- `Backend/src/config/database.js`
- `Backend/.env` was inspected only for MongoDB connection-shape analysis; credentials are intentionally not reproduced here.

INSZoom frontend files read:

- `INSZoom/frontend/src/App.jsx`
- `INSZoom/frontend/src/layouts/Layout.jsx`
- `INSZoom/frontend/src/contexts/AuthContext.jsx`
- `INSZoom/frontend/src/services/api.js`
- `INSZoom/frontend/src/pages/CaseManagers.jsx`
- `INSZoom/frontend/src/components/CreateCaseModal.jsx`
- `INSZoom/frontend/src/pages/CRMCases.jsx`
- `INSZoom/frontend/src/utils/permissions.js`

---

## Section 3 - Key Findings

### Case Model

The current `Case` model is 1062 lines, not the 906+ line estimate in the handoff.

Confirmed field names:

| Purpose | Actual field |
|---|---|
| Case to client User | `user` |
| Parent to child Case | `parentCase` |
| Lead reference | `leadId` |
| Consultation reference | `consultationId` |
| Employer profile reference | `employerProfileId` |
| Person profile reference | `personProfileId` |

Important discrepancy: the onboarding handoff and Phase 5 prompt refer to `caseLeadId` and `caseConsultationId`, but the schema explicitly uses `leadId` and `consultationId`. The schema comments also state that these names were chosen deliberately.

Confirmed Phase 2 fields:

- `caseStructure`: enum `["single", "employer_employee", "family"]`
- `caseRole`: enum `["single", "principal", "employee", "beneficiary"]`
- `childIndex`
- `childCaseCount`
- `creationSource`: enum `["lead_conversion", "admin_direct", "team_lead_direct"]`
- `leadId`
- `consultationId`
- `employerProfileId`
- `personProfileId`
- `dataEntryMode`: enum `["not_required", "not_set", "fill_self", "invite"]`
- `assignmentOverridden`

The `Case.pre("validate")` hook syncs legacy identifiers:

- If `caseId` is missing, it is set from `caseNumber`.
- If `caseNumber` is missing, it is set from `caseId`.
- If `clientPortalId` is missing, it is set from `caseId` or `caseNumber`.

Phase 5 can rely on that hook, but the safer implementation plan is still to set `caseId`, `caseNumber`, and `clientPortalId` explicitly for clarity and backward compatibility.

### Profile Models

`EmployerProfile` requires only `principalCaseId`.

`EmployeeProfile` requires:

- `caseId`
- `principalCaseId`
- `profileType`, enum `["employee", "beneficiary"]`

Both profile models use timestamps and have default canonical data structures.

### Case Numbers

`Counter.nextValue(key)` accepts only `key`; it has no session parameter.

`CaseNumberService.nextPrincipalCaseNumber()` also accepts no session and calls `Counter.nextValue("caseNumber")`.

`CaseNumberService.childCaseNumber(parentCaseNumber, index)` returns display children such as:

- index `0` -> `B001-A`
- index `25` -> `B001-Z`
- index `26` -> `B001-AA`

Because counter writes cannot currently be included in a Mongoose transaction, case numbers must be generated before the create unit begins. Gaps are acceptable because `caseNumber` is display-only.

### Visa Category Mapping

`getCaseStructure(visaType)` exists in `Backend/src/config/visaCategories.js`.

Confirmed outputs:

- `getCaseStructure("H-1B")` -> `employer_employee`
- `getCaseStructure("K-1")` -> `family`
- `getCaseStructure("I-539-COS")` -> `single`
- unknown visa type -> `null`

Important frontend note: `visaCategories.js` uses display keys such as `H-1B`, while `Backend/src/config/visaTypes.js` uses compact keys such as `H1B`. The INSZoom create form must send display-style strings compatible with `visaCategories.js`.

### Existing `POST /api/cases`

`Backend/src/modules/cases/case.routes.js` currently has:

```js
authorizeRoles("super_admin", "admin", "team_lead", "case_manager")
```

on `POST /api/cases`.

This conflicts with the Phase 5 invariant that only `super_admin`, `admin`, and `team_lead` may create cases through the new endpoint.

The current `exports.createCase` handler:

- Is non-transactional.
- Creates exactly one `Case`.
- Uses legacy `generateCaseNumber`, not `CaseNumberService`.
- Spreads `req.body` into `Case.create`.
- Does not create `User`, `EmployerProfile`, or `EmployeeProfile`.
- Calls `hydrateCaseRelationships`, `setStage`, `workflowService.caseCreated`, `writeAuditLog`, and `lifecycleOrchestrator.initializeCase`.

No production code calls `createCase` directly as a service function. It is only mounted through the route.

### Existing Lifecycle and Notification Flow

`lifecycleOrchestrator.initializeCase()` calls `notifyCaseCreated()` internally.

`notifyCaseCreated()` sends:

- Client notification/email using `case-created-client`
- Team lead notification/email using `case-created-team-lead`
- Realtime `case:created` events

Because `initializeCase()` triggers notifications, Phase 5 must call it after the create operation succeeds, not inside a transaction or halfway through compensating writes.

The existing `clientInvite.service.js` can generate invite tokens, but `createClientInviteToken(user)` performs its own `user.save()` and does not accept a session. Therefore Phase 5 should not call it inside the atomic create unit. The better approach is to reuse `generateOpaqueToken()` and `hashToken()` from `password.service.js` directly while creating the stub user.

### MongoDB Transaction Support

`Backend/src/config/database.js` connects with `mongoose.connect(env.mongoUri, poolOptions)`.

The current MongoDB URI shape is a direct `mongodb://host:27017/database?...` connection with no visible `replicaSet` parameter. No existing application code uses `mongoose.startSession`, `startTransaction`, `withTransaction`, or `.session(...)`.

Native transaction support is therefore not safe to assume. Per the Phase 5 prompt, the implementation should use compensating writes unless the real deployment is confirmed to be replica-set backed.

### INSZoom Frontend

INSZoom uses axios, not the BAIS custom fetch wrapper. New INSZoom code should use `response.data` and `error.response?.data`.

Current create case UI:

- `CRMCases.jsx` opens `CreateCaseModal`.
- `CreateCaseModal.jsx` currently calls `casesApi.createWithClient(payload)`.
- It posts to `/cases/create-with-client`, not `/cases`.
- It supports the old single-case create-with-client flow, not Phase 5 structures.
- `CRMCases.jsx` currently allows `case_manager` to open the modal.

`casesApi.create(payload)` already exists and posts to `/cases`.

`permissions.js` currently says `cases:create` is allowed only for `super_admin` and `admin`, while `CRMCases.jsx` locally allows `team_lead` and `case_manager`. This is inconsistent with Phase 5, which should allow `team_lead` but not `case_manager`.

---

## Section 4 - Challenge / Blocker Found

The main blocker is a policy conflict between two instructions:

1. The Phase 5 prompt says that if MongoDB transactions are not supported, use compensating writes and remove every document created if any later step fails.
2. The architectural invariants say never hard-delete any `Case`, `EmployerProfile`, `EmployeeProfile`, `CaseForm`, `FormTemplate`, `AuditLog`, or `Lead`.

Because native transactions are not confirmed, the likely implementation path is compensating writes. But compensating writes require cleanup of partially created `Case`, `EmployerProfile`, `EmployeeProfile`, and `User` documents. `Case` has archival/status fields, but `EmployerProfile` and `EmployeeProfile` do not have an obvious soft-delete/status field. Adding such fields would be a model schema change, and the Phase 5 prompt did not request it.

For that reason, implementation was paused before modifying source code. This was done to avoid silently choosing between:

- hard-deleting newly-created failed-attempt documents, which violates the invariant, or
- leaving archived/orphaned profile records, which weakens the "atomic" guarantee, or
- modifying profile schemas to support soft rollback, which is outside the prompt's explicit scope.

---

## Section 5 - Pre-Implementation Gate Answers

1. Exact field name linking Case to client User: YES - `Case.user`.
2. Exact field name for parent-child Case relationship: YES - `Case.parentCase`.
3. MongoDB transactions support confirmed: YES, in the practical sense required by the prompt - not safe to assume; use compensating writes unless deployment proves replica-set support.
4. Case numbers before or inside transaction: YES - before the create unit.
5. Lifecycle calls after case creation: YES - `workflowService.caseCreated`, `caseService` audit/timeline helpers, `lifecycleOrchestrator.initializeCase`, with notification-causing lifecycle work after the create unit succeeds.
6. Setup token mechanism: YES - opaque random token, hashed on `User.inviteTokenHash`, expiry on `User.inviteTokenExpiresAt`, raw token only used in the email/setup link.
7. Will not modify `POST /api/cases/create-with-client`: YES.
8. Will not modify BAIS frontend: YES.

Required commitment, with the blocker noted:

> I have read every file I would touch. I understand the Case model including the relevant existing fields and hook behavior. I understand that MongoDB native transactions are not safe to assume in this environment and that the prompt points toward compensating writes. I will not modify create-with-client. I will not touch the BAIS frontend. Notifications must fire only after the create unit succeeds. Single-visa cases must create exactly one Case document with zero children, zero EmployerProfile, and zero EmployeeProfile. I stopped before implementation because the compensating-write cleanup requirement conflicts with the no-hard-delete invariant.

---

## Section 6 - Proposed Implementation Plan

This was the planned implementation before the blocker paused the work.

### Backend - Case Creation Transaction

| File | Planned change |
|---|---|
| `Backend/src/modules/cases/case.controller.js` | Replace `exports.createCase` with Phase 5 create logic. Use `CaseNumberService`, `getCaseStructure`, `EmployerProfile`, `EmployeeProfile`, `User`, and setup-token helpers. Create principal case, child cases, profile documents, and stub client user as one compensating unit. Call lifecycle and notifications after success. |
| `Backend/src/modules/cases/case.routes.js` | Narrow `POST /api/cases` role guard to `authorizeRoles("super_admin", "admin", "team_lead")`. Keep validation middleware. Do not touch `/create-with-client`. |

No planned changes to:

- `Counter.js`
- `CaseNumberService.js`
- `EmployerProfile.js`
- `EmployeeProfile.js`
- `Case.js`
- `User.js`

Those files already contain the required support, except for native transaction support, which is bypassed by generating case numbers before the create unit.

### Backend - Setup Token

| File | Planned change |
|---|---|
| `Backend/src/modules/cases/case.controller.js` | Import `generateOpaqueToken` and `hashToken` from `Backend/src/modules/auth/password.service.js`. Store only the hash and expiry on the stub `User`. Use the raw token only in the post-success setup email/link. |

No planned change to `clientInvite.service.js` because its token function saves the user directly and does not support sessions.

### INSZoom Frontend - Create Case Form

| File | Planned change |
|---|---|
| `INSZoom/frontend/src/components/CreateCaseModal.jsx` | Rework the existing modal to use `casesApi.create()` instead of `casesApi.createWithClient()`. Add required Phase 5 inputs for structured case creation. Ensure visa values sent to the backend match `visaCategories.js` display keys such as `H-1B`, `K-1`, and `I-539-COS`. |
| `INSZoom/frontend/src/pages/CRMCases.jsx` | Limit New Case access to `super_admin`, `admin`, and `team_lead`; remove `case_manager` from the local create-role list. Continue refreshing the case list after creation. |
| `INSZoom/frontend/src/utils/permissions.js` | Align `cases:create` with Phase 5 by including `team_lead` and excluding `case_manager`, if the modal uses permission helpers or if consistency cleanup is approved. |

No planned change to:

- `INSZoom/frontend/src/App.jsx`
- `INSZoom/frontend/src/layouts/Layout.jsx`
- BAIS frontend
- Lead endpoints

---

## Section 7 - What Was Done

Completed:

- Read the available Phase 5 prompt from the attached markdown.
- Read Phase 1 through Phase 4 completion reports.
- Confirmed actual Case model fields and enums.
- Confirmed actual profile model required fields.
- Confirmed counter and case number service behavior.
- Confirmed visa category key format and `getCaseStructure()` behavior.
- Read current backend case routes, controller, and service.
- Confirmed existing `POST /api/cases` still uses the old non-transactional handler.
- Confirmed `POST /api/cases/create-with-client` exists and should remain untouched.
- Confirmed existing notification/email infrastructure and lifecycle side effects.
- Confirmed setup token fields already exist on `User`.
- Confirmed INSZoom frontend currently uses the legacy create-with-client modal.
- Identified the transaction/compensating-write policy conflict.
- Stopped before source-code implementation.
- Created this report.

Not completed:

- No new `createCase` handler was implemented.
- No route guard was changed.
- No INSZoom create form was changed.
- No backend server was started.
- No live HTTP/database verification was run.

---

## Section 8 - Files Modified

Only this file was created:

1. `PHASE_5_COMPLETION_REPORT.md`

No backend source file was modified.

No frontend source file was modified.

No model schema was modified.

---

## Section 9 - Verification Results

| Check | Result |
|---|---|
| Phase 1-4 reports read | PASS |
| Attached Phase 5 prompt read | PASS |
| Case model field names confirmed | PASS |
| Profile model required fields confirmed | PASS |
| Case number service behavior confirmed | PASS |
| Visa structure mapping confirmed | PASS |
| Current case creation route/controller read | PASS |
| Notification/email infrastructure read | PASS |
| INSZoom create-case UI read | PASS |
| Native transaction support confirmed available | NOT CONFIRMED |
| Compensating-write approach selected by prompt rules | YES, but blocked by hard-delete invariant conflict |
| Source implementation performed | NOT RUN / PAUSED |
| Backend startup verification | NOT RUN |
| Live case creation verification | NOT RUN |
| Frontend build verification | NOT RUN |

---

## Section 10 - Phase 5 Verdict

**PHASE 5 IS NOT COMPLETE.**

The investigation phase is complete and produced actionable implementation findings, but implementation was intentionally paused before touching source files because the required fallback strategy creates a real architectural conflict.

The next agent or human reviewer should decide one of the following before implementation resumes:

1. Allow hard deletion only for documents created during a failed compensating-write case creation attempt.
2. Confirm production MongoDB supports native transactions and implement a true Mongoose transaction path.
3. Approve a small schema addition to `EmployerProfile` and `EmployeeProfile` to support soft rollback/archive flags.

Once that decision is made, Phase 5 can resume from Step 11/Step 12 using the proposed implementation plan above.
