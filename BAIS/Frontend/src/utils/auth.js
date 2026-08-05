// Single source of truth for "is this an invited-employee account" — an
// employee only ever sees their own case's Documents/checklist page, never
// profile-as-client, plan/filing/payments, or other cases. Previously this
// check was re-implemented independently in ~7 places (ProtectedRoute,
// Dashboard, Navbar, Documents, Intake, questionnaireEngine), risking drift
// if the role naming ever changes.
export function isEmployeeAccount(user) {
  return user?.role === "employee";
}
