# Phase 10 Completion Report - Employee/Beneficiary Restricted Portal + Hard Server-Side RBAC

## Status

Implemented.

No Markdown files were deleted as part of Phase 10.

## Backend Changes

- Tightened restricted account case access in `Backend/src/modules/cases/case.service.js`.
  - `employee` and `beneficiary` users now fail closed to their own child case only.
  - Principal cases and sibling child cases are denied even when they share the same principal matter.
  - Case list filters for restricted users now use server-authorized case IDs only.
  - Restricted case serialization removes internal notes, audit history, assignment fields, parent/child references, linked cases, plans, payments, upgrade data, and internal timeline events.

- Hardened case endpoints in `Backend/src/modules/cases/case.controller.js`.
  - Restricted users cannot access add-on/upgrades.
  - Restricted users cannot mutate case plans or assessment data.
  - Related-record responses for restricted users remove parent case, child cases, tasks, workflows, and payments.
  - Timeline responses for restricted users omit audit history and internal activity logs.

- Hardened employer and employee canonical profiles.
  - `Backend/src/modules/employer-profile/*`
    - Full `EmployerProfile` reads are principal-owner/staff only.
    - Added `GET /api/employer-profile/summary/me`, which derives the principal from the authenticated child case and returns only a minimized summary.
  - `Backend/src/modules/employee-profile/employee-profile.service.js`
    - Restricted users must own the case and match the child case role before reading or writing their profile.

- Hardened documents.
  - `Backend/src/modules/documents/document.routes.js`
    - Added `beneficiary` to document read-capable roles.
  - `Backend/src/modules/documents/document.service.js`
    - Restricted users may upload only to their own child case.
    - Resumable upload session creation now validates the target case immediately.
    - Metadata-only document creation now uses the same server-side case authorization as file upload.
    - Non-staff users cannot spoof document ownership through `user` or `userId` request body fields.
  - `Backend/src/modules/documents/document.controller.js`
    - Metadata-only document creation now delegates to the hardened service path.

## Frontend Changes

- `BAIS/Frontend/src/components/AuthGate.jsx`
  - Employee/beneficiary accounts can access only `/dashboard`, `/dashboard/documents`, and `/dashboard/profile`.
  - Unknown client-portal roles fail closed.

- `BAIS/Frontend/src/components/Navbar.jsx`
  - Restricted accounts see only Dashboard, Documents, and Profile navigation.

- `BAIS/Frontend/src/Pages/Dashboard/Dashboard.jsx`
  - Restricted dashboard no longer requests payments, unread messages, or upgrade data.
  - Messages card remains hidden for restricted accounts.

- `BAIS/Frontend/src/Pages/Dashboard/Profile.jsx`
  - Restricted users load and save their own `EmployeeProfile` data instead of the legacy client intake profile.

- `BAIS/Frontend/src/Pages/Dashboard/Documents.jsx`
  - Employee/beneficiary self-service no longer depends on `parentCase` being exposed in the case response.

- `BAIS/Frontend/src/components/questionnaire/EmployeeSelfServiceView.jsx`
  - Uses the new minimized employer summary endpoint.

- `BAIS/Frontend/src/services/api.js`
  - Added `employerProfileApi.mySummary()`.

## Tests Added

- `Backend/src/modules/authorization/tests/phase10-restricted-portal-rbac.test.js`
  - Employee own child case allow.
  - Employee principal case deny.
  - Employee sibling child case deny.
  - Employee/beneficiary role mismatch deny.
  - Restricted case list filters use server-authorized case IDs only.
  - Document upload gate follows the same restricted ownership checks.

## Verification

Passed:

- `node --check Backend/src/modules/cases/case.service.js`
- `node --check Backend/src/modules/cases/case.controller.js`
- `node --check Backend/src/modules/documents/document.service.js`
- `node --check Backend/src/modules/employee-profile/employee-profile.service.js`
- `node --check Backend/src/modules/employer-profile/employer-profile.service.js`
- `node --check Backend/src/modules/employer-profile/employer-profile.controller.js`
- `node --test Backend/src/modules/authorization/tests/phase10-restricted-portal-rbac.test.js`
- `node --test Backend/src/modules/documents/tests/document-intelligence-platform.test.js`
- `npm run build` in `BAIS/Frontend`

Broader backend suite:

- `npm test` in `Backend` completed with 487 passing and 62 failing tests.
- The failures are dominated by sandbox/external-service access errors such as MongoDB/S3 `EACCES`, plus pre-existing fixture/route-count assertions unrelated to the Phase 10 changes.
- The one failure caused by an out-of-scope upload-role broadening was reverted, and the affected document platform test was rerun successfully.

## Notes

- Phase 10 deliberately does not create new cases, duplicate profile systems, or introduce a second auth model.
- No hard-delete behavior was added.
- The restricted portal now relies on backend authorization first; frontend hiding is only a UX layer.
