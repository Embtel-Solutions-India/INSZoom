// Single source of truth for "is this an invited-employee account" — an
// employee only ever sees their own case's Documents/checklist page, never
// profile-as-client, plan/filing/payments, or other cases. Previously this
// check was re-implemented independently in ~7 places (ProtectedRoute,
// Dashboard, Navbar, Documents, Intake, questionnaireEngine), risking drift
// if the role naming ever changes.
export function isEmployeeAccount(user) {
  // Phase 9: an invited beneficiary on a family-visa child case (see
  // Backend/src/modules/cases/case.controller.js's inviteEmployee) is the
  // same "invited second party, self-service only" account shape as an
  // invited employee — same confinement to /dashboard/documents applies.
  // The backend already treats these two roles as permission-equivalent
  // (see permissions.registry.js's comment on the "beneficiary" role).
  return user?.role === "employee" || user?.role === "beneficiary";
}
