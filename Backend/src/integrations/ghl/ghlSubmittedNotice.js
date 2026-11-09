const Case = require("../../models/Case");
const User = require("../../models/User");
const EmailLog = require("../../models/EmailLog");
const logger = require("../../utils/logger");

// The congratulations e-mail ("case-submitted-client"): sent to the client ONLY when the internal team chooses to, in the popup that follows a move of the
// card into the Submitted stage (Pipeline drag or Update Stage). A move itself - by the team or from GoHighLevel - never sends it. The e-mail never
// throws, so a mail problem can never fail or slow a stage change.
//   - sendOnTeamChoice is the only sender; sendSubmittedNotice below is the older automatic one and is no longer called;
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

// The client's Tasks page (the case workflow, cached for 30 s) shows "Filed" completed once the card is at Submitted or later: expire that cache
// on a move so the next read recalculates it, in both directions (a card moved back out un-completes it). Never throws.
async function refreshClientProgress(caseDoc) {
  try {
    await Case.updateOne({ _id: caseDoc._id }, { $unset: { lastSyncedAt: 1 } }, { timestamps: false });
  } catch (error) {
    logger.warn("ghl_progress_refresh_failed", { caseId: String(caseDoc?._id), error: error.message });
  }
}

/**
 * Fire-and-forget wrapper for the move sites. A move into Submitted NO LONGER e-mails the client by itself: the internal team is asked (a popup in the admin app)
 * and the e-mail goes out only if they choose to send it - see sendOnTeamChoice below. A move only refreshes the client's progress here.
 */
function notifySubmitted(args) {
  try {
    refreshClientProgress(args.caseDoc).catch(() => {});
  } catch (_error) {
    /* never affects the move */
  }
}

// Records the team's choice on the case timeline (best effort: a failure here never changes the answer).
async function recordChoice(caseId, user, send, outcome) {
  try {
    const caseService = require("../../modules/cases/case.service");
    const doc = await Case.findById(caseId);
    if (!doc) return;
    caseService.addTimelineEvent(
      doc,
      "case",
      send ? "Client informed of submission" : "Client not informed of submission",
      send ? (outcome?.sent ? "The case-completion e-mail was sent to the client" : "The team chose to e-mail the client, but no e-mail was sent") : "The team chose not to e-mail the client about the submission",
      user,
      { source: "submitted_notice_choice", send, sent: Boolean(outcome?.sent), reason: outcome?.reason || null }
    );
    await doc.save();
  } catch (error) {
    logger.warn("ghl_submitted_choice_record_failed", { caseId: String(caseId), error: error.message });
  }
}

/**
 * The team's answer to "tell the client their case is complete?" for a case that now sits at Submitted (any case type: single, family, employer's employee).
 *   send: true  -> the congratulations e-mail goes to the client (once per case; the usual client-only rules apply)
 *   send: false -> nothing is sent, ever, for this move
 * Never throws: the answer is { sent, reason }.
 */
async function sendOnTeamChoice({ caseId, send, user }) {
  try {
    const caseDoc = await Case.findById(caseId);
    if (!caseDoc) return { sent: false, reason: "case_not_found" };
    if (caseDoc.integrations?.ghl?.unifiedStageKey !== SUBMITTED_STAGE_KEY) return { sent: false, reason: "not_at_submitted" };
    if (!send) {
      await recordChoice(caseId, user, false, null);
      return { sent: false, reason: "team_chose_not_to_send" };
    }
    if (caseDoc.caseRole === "principal" && caseDoc.caseStructure === "employer_employee") return { sent: false, reason: "employer_matter" };
    const already = await EmailLog.findOne({ templateKey: TEMPLATE, caseId: caseDoc._id, status: { $in: ["sent", "queued"] } }).select("_id").lean();
    if (already) return { sent: false, reason: "already_sent" };
    const client = await recipientFor(caseDoc);
    if (!client) return { sent: false, reason: "no_client_login" };
    const { sendTemplateEmail } = require("../../modules/email/email.service");
    const result = await sendTemplateEmail(TEMPLATE, {
      to: client.email,
      caseId: caseDoc._id,
      userId: client._id,
      recipientRole: client.role,
      triggeredBy: user?._id, // EmailLog.triggeredBy is a User id: the case manager who chose to send it
      data: { clientName: caseDoc.clientName || client.name || client.displayName, caseNumber: caseDoc.caseNumber },
    });
    const outcome = { sent: Boolean(result?.sent), reason: result?.reason };
    await recordChoice(caseId, user, true, outcome);
    return outcome;
  } catch (error) {
    logger.warn("ghl_submitted_notice_choice_failed", { caseId: String(caseId), error: error.message });
    return { sent: false, reason: "error" };
  }
}

module.exports = { notifySubmitted, sendSubmittedNotice, sendOnTeamChoice, SUBMITTED_STAGE_KEY };
