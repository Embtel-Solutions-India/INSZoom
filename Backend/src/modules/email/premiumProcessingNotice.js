// Tells the right person - by email, in-app notification AND browser push - that a case was upgraded to Premium Processing. Called
// wherever the upgrade reaches the client: when a case manager approves the Form I-907 checklist after upgrading a case
// (case-checklist.service.js), and when the client's own I-907 payment is received (payments/payment.service.js).
//
// Who is "the person the case belongs to":
//   - an employee's (child) case, once the employee has been invited: only that employee - never the employer;
//   - an employee's case the employer still holds (employee not invited yet - the child's user is the employer's): the employer side;
//   - an employer / single-applicant case: its owner, plus the delegate employer when the case has one.
// Never throws: a notification problem must not fail the upgrade itself.
const User = require("../../models/User");
const Case = require("../../models/Case");
const notificationService = require("../notifications/notification.service");
const logger = require("../../utils/logger");

const idOf = (value) => (value ? String(value._id || value) : "");

async function resolveRecipientIds(caseData) {
  const ownerId = idOf(caseData.user || caseData.clientProfile);
  if (caseData.caseRole !== "employee") return [ownerId, idOf(caseData.delegateEmployerUser)];
  const principalId = caseData.parentCase || caseData.principalCaseRef;
  const principal = principalId ? await Case.findById(principalId).select("user delegateEmployerUser").lean() : null;
  const employerId = idOf(principal?.user);
  if (ownerId && ownerId !== employerId) return [ownerId]; // an invited employee holds their own case
  return [ownerId || employerId, idOf(principal?.delegateEmployerUser)];
}

async function notifyPremiumProcessingUpgrade(caseData, { triggeredBy } = {}) {
  try {
    const recipientIds = [...new Set((await resolveRecipientIds(caseData)).filter(Boolean))];
    const recipients = recipientIds.length ? await User.find({ _id: { $in: recipientIds } }).select("name displayName email role") : [];
    const results = [];
    for (const recipient of recipients) {
      const name = recipient.name || recipient.displayName;
      results.push(await notificationService.createNotification({
        userId: recipient._id,
        type: "case",
        category: "case",
        title: "Your case has been upgraded to Premium Processing",
        message: `Case ${caseData.caseNumber} has been upgraded to Premium Processing. Please complete the Form I-907 information in your case checklist.`,
        caseId: caseData._id,
        priority: "high",
        channels: ["in_app", "socket", "email", "push"],
        link: "/dashboard",
        source: "shared",
        dedupeKey: `premium-processing-upgraded:${caseData._id}:${recipient._id}`,
        emailTemplate: "premium-processing-upgraded",
        emailTo: recipient.email || undefined,
        emailData: { clientName: name, caseNumber: caseData.caseNumber },
      }, triggeredBy ? { _id: triggeredBy } : undefined).catch((error) => {
        logger.error("premium_processing_upgrade_notice_failed", { caseId: String(caseData._id), userId: String(recipient._id), error: error.message });
        return null;
      }));
    }
    return { notified: results.filter(Boolean).length };
  } catch (error) {
    logger.error("premium_processing_upgrade_notice_failed", { caseId: String(caseData?._id), error: error.message });
    return { notified: 0, error };
  }
}

module.exports = { notifyPremiumProcessingUpgrade, resolveRecipientIds };
