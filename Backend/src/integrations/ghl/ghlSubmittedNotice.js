const Case = require("../../models/Case");
const User = require("../../models/User");
const EmailLog = require("../../models/EmailLog");
const logger = require("../../utils/logger");

// The congratulations e-mail ("case-submitted-client"): sent to the client when their case card MOVES INTO the Submitted stage on the Pipeline,
// whoever moved it (the team, Update Stage, or GoHighLevel). It is a side effect of the move: it runs after the move is saved, is never awaited by
// the caller and never throws, so a mail problem can never fail or slow a stage change.
//   - only on a real move into the stage (previous stage != Submitted), so a re-sync of a card that is already there sends nothing;
//   - once per case: an earlier sent / queued e-mail of this kind for the case stops a second one (a card moved out and back in);
//   - client only: a family case goes to the petitioner; an employee case only when the employee has their own login (not an employer-filled slot).
const SUBMITTED_STAGE_KEY = "submitted_fedex";
const TEMPLATE = "case-submitted-client";

async function recipientFor(caseDoc) {
  const ghl = caseDoc.integrations?.ghl || {};
  if (caseDoc.caseRole === "employee") {
    const parent = caseDoc.parentCase ? await Case.findById(caseDoc.parentCase).select("user").lean() : null;
    if (!caseDoc.user || (parent && String(parent.user) === String(caseDoc.user))) return null; // employer-filled slot: the employer is not "the client" of this card
  }
  const userId = ghl.role === "family" ? (caseDoc.petitionerUser || caseDoc.user) : caseDoc.user;
  if (!userId) return null;
  const user = await User.findById(userId).select("name displayName email role isActive").lean();
  if (!user?.email || user.isActive === false) return null;
  return user;
}

async function sendSubmittedNotice({ caseDoc, previousKey }) {
  try {
    const key = caseDoc?.integrations?.ghl?.unifiedStageKey;
    if (key !== SUBMITTED_STAGE_KEY || previousKey === SUBMITTED_STAGE_KEY) return { sent: false, reason: "not_a_move_into_submitted" };
    if (caseDoc.caseRole === "principal" && caseDoc.caseStructure === "employer_employee") return { sent: false, reason: "employer_matter" };
    const already = await EmailLog.findOne({ templateKey: TEMPLATE, caseId: caseDoc._id, status: { $in: ["sent", "queued"] } }).select("_id").lean();
    if (already) return { sent: false, reason: "already_sent" };
    const user = await recipientFor(caseDoc);
    if (!user) return { sent: false, reason: "no_client_login" };
    const { sendTemplateEmail } = require("../../modules/email/email.service");
    const result = await sendTemplateEmail(TEMPLATE, {
      to: user.email,
      caseId: caseDoc._id,
      userId: user._id,
      recipientRole: user.role,
      triggeredBy: "pipeline_stage_submitted",
      data: { clientName: caseDoc.clientName || user.name || user.displayName, caseNumber: caseDoc.caseNumber },
    });
    return { sent: Boolean(result?.sent), reason: result?.reason };
  } catch (error) {
    logger.warn("ghl_submitted_notice_failed", { caseId: String(caseDoc?._id), error: error.message });
    return { sent: false, reason: "error" };
  }
}

/** Fire-and-forget wrapper for the move sites. */
function notifySubmitted(args) {
  try {
    sendSubmittedNotice(args).catch(() => {});
  } catch (_error) {
    /* never affects the move */
  }
}

module.exports = { notifySubmitted, sendSubmittedNotice, SUBMITTED_STAGE_KEY };
