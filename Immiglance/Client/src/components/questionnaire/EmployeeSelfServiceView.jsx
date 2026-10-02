import { useState } from "react";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import EmployeePacketStepper from "./EmployeePacketStepper";

// Rendered by Documents.jsx for an invited employee/beneficiary's own
// session (activeCase.caseRole is 'employee' or 'beneficiary', not
// 'principal'). Shows only their own packet, through the same
// EmployeePacketStepper (Documents -> Information -> Review) the employer's
// own fill-self flow uses in PrincipalCaseWorkspace.jsx, then a thank-you
// screen once Save & Return succeeds — there is no "back to dashboard" here
// because there IS no dashboard for this account; it never had one.
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
  const [submitted, setSubmitted] = useState(false);

  const qa = useQuestionnaireAnswers(activeCase._id, employeeTargetRole, { disabled: submitted });

  if (submitted) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl">✓</div>
        <h2 className="text-lg font-bold text-slate-900">You're all set{activeCase.clientName ? `, ${activeCase.clientName.split(" ")[0]}` : ""}.</h2>
        <p className="text-sm text-slate-500">
          Your case team has been notified and will review your information shortly.
        </p>
        <button type="button" onClick={() => setSubmitted(false)} className="text-sm font-semibold text-slate-700 underline underline-offset-2">
          Review what you submitted
        </button>
      </div>
    );
  }

  return (
    <EmployeePacketStepper
      qa={qa}
      caseId={activeCase._id}
      employeeLabel="Your Information"
      onSubmitted={() => setSubmitted(true)}
    />
  );
}
