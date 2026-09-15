import CaseRoleChecklist from "./CaseRoleChecklist";

// Rendered by Documents.jsx for an invited employee/beneficiary's own
// session (activeCase.caseRole is 'employee' or 'beneficiary', not
// 'principal'). Shows only their own checklist, through the same card-based
// ChecklistItemRow UI + OCR autofill as everywhere else, via
// CaseRoleChecklist.
//
// Deliberately does NOT show the employer/petitioner's checklist, even
// read-only: an invited employee's account is a "restricted portal role"
// (see case.service.js's canAccessRestrictedChildCase) explicitly confined
// to only their own case (caseData.caseRole must equal their own role) —
// this is an intentional security boundary, not an oversight, and the
// original spec's "read-only employer summary" requirement was for the
// EMPLOYER's own fill-self tabs in PrincipalCaseWorkspace.jsx (where the
// employer legitimately already has access to both), not for an invited
// employee's separate account.
export default function EmployeeSelfServiceView({ activeCase }) {
  const isFamily = activeCase.caseStructure === "family";
  const employeeTargetRole = isFamily ? "beneficiary" : "employee";

  return <CaseRoleChecklist caseId={activeCase._id} targetRole={employeeTargetRole} />;
}
