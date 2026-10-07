// "Save progress" alert: when a client-side user (client, employer, delegate employer, employee) saves what they have filled
// in on a checklist, the case's assigned case manager - and only the case manager, never administrators - gets the
// "questionnaire-progress-saved" email with a link to review it in Admin. One email per case per 30 minutes (the trigger's
// cooldown, see emailPolicy.js) so a client who saves repeatedly does not flood the case manager.
const Case = require("../../models/Case");
const User = require("../../models/User");
const caseService = require("../cases/case.service");
const emailService = require("../email/email.service");
const { isClientSideUser } = require("./checklist-gate");
const logger = require("../../utils/logger");

const sameId = (left, right) => Boolean(left && right && String(left._id || left) === String(right._id || right));
const displayName = (user) => user?.displayName || user?.name || user?.email || "";

// Who is saving, in the words the case manager recognises.
function fillerLabel(caseData, parentCase, user) {
  if (sameId(caseData.delegateEmployerUser, user._id) || sameId(parentCase?.delegateEmployerUser, user._id)) return "Delegate employer";
  if (caseData.caseRole === "employee") return parentCase && sameId(parentCase.user, user._id) ? "Employer (filling in for the employee)" : "Employee";
  if (caseData.caseStructure === "employer_employee") return "Employer";
  return "Client";
}

// Returns { sent, reason } and never throws - a failed alert must never fail the save that triggered it.
async function notifyProgressSaved({ caseId, checklistName, completionPercentage }, user, req) {
  try {
    const caseData = await Case.findById(caseId).select("caseNumber visaType clientName petitionerName user parentCase caseRole caseStructure delegateEmployerUser assignedCaseManager").lean();
    if (!caseData) return { sent: false, reason: "case_not_found" };
    if (!caseService.canAccessCase(user, caseData)) return { sent: false, reason: "not_authorized" };
    // Staff editing a client's answers from Admin is not "the client filled it in".
    if (!isClientSideUser(user)) return { sent: false, reason: "staff_user" };

    const manager = caseData.assignedCaseManager ? await User.findById(caseData.assignedCaseManager).select("name displayName email role isActive").lean() : null;
    if (!manager?.email || manager.isActive === false || String(manager.role) !== "case_manager") return { sent: false, reason: "no_case_manager" };

    const parentCase = caseData.parentCase ? await Case.findById(caseData.parentCase).select("user delegateEmployerUser petitionerName clientName").lean() : null;
    const who = displayName(user) || "A client";
    const result = await emailService.sendTemplateEmail("questionnaire-progress-saved", {
      to: manager.email,
      recipientRole: manager.role,
      caseId: caseData._id,
      userId: manager._id,
      triggeredBy: user._id,
      source: "shared",
      data: {
        recipientName: displayName(manager),
        caseManagerName: displayName(manager),
        clientName: who,
        filledBy: fillerLabel(caseData, parentCase, user),
        caseNumber: caseData.caseNumber,
        visaType: caseData.visaType,
        employerName: parentCase?.petitionerName || caseData.petitionerName || undefined,
        checklistName: checklistName ? String(checklistName).slice(0, 120) : undefined,
        completionPercentage: Number.isFinite(Number(completionPercentage)) ? Math.round(Number(completionPercentage)) : undefined,
      },
    });
    return { sent: Boolean(result?.sent), reason: result?.reason };
  } catch (error) {
    logger.error("progress_saved_alert_failed", { caseId: String(caseId), error: error.message });
    return { sent: false, reason: "error" };
  }
}

module.exports = { notifyProgressSaved, fillerLabel };
