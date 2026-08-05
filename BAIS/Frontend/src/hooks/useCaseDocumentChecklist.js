import { useMemo } from "react";

// Reusable-document checklist only (Passport, Resume, Business License, I-94,
// etc.) — shared by the client portal Documents page and the Dashboard
// document widget so the two never show different lists. Conditional
// documents that depend on questionnaire answers (e.g. "Upload FEIN Letter"
// when DOL verification = No) live inside the questionnaire itself
// (QuestionnaireRenderer / CaseChecklistPanel, rendered from Profile.jsx and
// EmployerWorkspace.jsx) — this hook no longer merges them in, and does not
// gate on visa type (isH1BCase/isL1ACase), since the reusable checklist is
// the same shape for every visa.
export default function useCaseDocumentChecklist(caseData, role) {
  const normalizedRole = String(role || "client").toLowerCase();
  // A single "client" portal login often drives an employer-sponsored case
  // without a separate employer/employee login — fall back to whichever side
  // the intake assessment recorded them as, so they see the right slice of
  // the reusable checklist.
  const intakeRole = caseData?.assessmentAnswers?.primaryApplicant;
  const employerCompletesEmployeePacket = caseData?.questionnaireData?.masterData?.employeeQuestionnaireAssignment?.mode === "employer_completes";

  const checklist = useMemo(() => {
    const rawChecklist = caseData?.documentChecklist || caseData?.checklistItems || caseData?.knowledgePlan?.documentRequirements || [];
    return rawChecklist.filter((item) => {
      const target = String(item.targetRole || item.target || "client").toLowerCase();
      if (!target || target === "both") return true;
      if (normalizedRole === "employer") return target === "employer" || (employerCompletesEmployeePacket && target === "employee");
      if (normalizedRole === "client" && intakeRole === "employer") return target === "employer";
      if (normalizedRole === "employee" || normalizedRole === "client") return ["employee", "client"].includes(target);
      return true;
    });
  }, [caseData, normalizedRole, intakeRole, employerCompletesEmployeePacket]);

  return { checklist };
}
