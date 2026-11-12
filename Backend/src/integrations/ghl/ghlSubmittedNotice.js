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
const ONLINE_TEMPLATE = "case-submitted-online-client"; // the same congratulations when the team says the case was submitted ONLINE (USCIS receipt number instead of the FedEx section)

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
    // a move into Submitted or any later stage means the case has been filed: its recorded status becomes Filed (quietly - no e-mail, no notification)
    require("../../modules/immigration-lifecycle/services/TrackingService").markFiledByStage(args.caseDoc._id).catch(() => {});
  } catch (_error) {
    /* never affects the move */
  }
}

// Records the team's choice on the case timeline (best effort: a failure here never changes the answer).
async function recordChoice(caseId, user, send, outcome, method) {
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
      { source: "submitted_notice_choice", send, sent: Boolean(outcome?.sent), reason: outcome?.reason || null, ...(method ? { method } : {}) }
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
async function sendOnTeamChoice({ caseId, send, user, method }) {
  try {
    const online = method === "online"; // anything else (including no method) is the original FedEx behaviour
    const caseDoc = await Case.findById(caseId);
    if (!caseDoc) return { sent: false, reason: "case_not_found" };
    if (caseDoc.integrations?.ghl?.unifiedStageKey !== SUBMITTED_STAGE_KEY) return { sent: false, reason: "not_at_submitted" };
    if (!send) {
      await recordChoice(caseId, user, false, null, method);
      return { sent: false, reason: "team_chose_not_to_send" };
    }
    if (caseDoc.caseRole === "principal" && caseDoc.caseStructure === "employer_employee") return { sent: false, reason: "employer_matter" };
    // once per case: either version (online / FedEx) already sent stops a second one
    const already = await EmailLog.findOne({ templateKey: { $in: [TEMPLATE, ONLINE_TEMPLATE] }, caseId: caseDoc._id, status: { $in: ["sent", "queued"] } }).select("_id").lean();
    if (already) return { sent: false, reason: "already_sent" };
    const client = await recipientFor(caseDoc);
    if (!client) return { sent: false, reason: "no_client_login" };
    const { sendTemplateEmail } = require("../../modules/email/email.service");
    const filing = caseDoc.immigrationLifecycle?.tracking?.filing;
    const result = await sendTemplateEmail(online ? ONLINE_TEMPLATE : TEMPLATE, {
      to: client.email,
      caseId: caseDoc._id,
      userId: client._id,
      recipientRole: client.role,
      triggeredBy: user?._id, // EmailLog.triggeredBy is a User id: the case manager who chose to send it
      // FedEx: the number, when the team has already entered it, goes inside this e-mail; without one the FedEx part is left out and the number follows in its own e-mail later.
      // Online: the USCIS receipt number takes the place of the FedEx section and is shown only when it has been entered.
      data: online
        ? { clientName: caseDoc.clientName || client.name || client.displayName, caseNumber: caseDoc.caseNumber, receiptNumber: filing?.receiptNumber || undefined }
        : { clientName: caseDoc.clientName || client.name || client.displayName, caseNumber: caseDoc.caseNumber, trackingNumber: filing?.trackingNumber || undefined },
    });
    const outcome = { sent: Boolean(result?.sent), reason: result?.reason };
    await recordChoice(caseId, user, true, outcome, method);
    return outcome;
  } catch (error) {
    logger.warn("ghl_submitted_notice_choice_failed", { caseId: String(caseId), error: error.message });
    return { sent: false, reason: "error" };
  }
}

const RECEIPT_TEMPLATE = "case-uscis-receipt-number-client";
const cleanReceipt = (value) => String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();

/**
 * The USCIS receipt number was added or changed by the team. If the client already got the "case submitted online" e-mail WITHOUT it, they get this separate e-mail with the number.
 * Same rules as the FedEx number e-mail: nothing is sent when the online submitted e-mail has not been sent (the team chose not to inform the client, or it is still to be sent - the number
 * then rides inside that e-mail), when the number is unchanged or that exact number was already e-mailed, or for an employer matter / a case with no client login.
 * Fire and forget: never throws, never slows or fails the save.
 */
async function sendReceiptNumberNotice({ caseId, receiptNumber, previous, user }) {
  try {
    const number = cleanReceipt(receiptNumber);
    if (!/^[A-Z]{3}\d{10}$/.test(number) || number === cleanReceipt(previous)) return { sent: false, reason: "unchanged" };
    const caseDoc = await Case.findById(caseId);
    if (!caseDoc) return { sent: false, reason: "case_not_found" };
    if (caseDoc.caseRole === "principal" && caseDoc.caseStructure === "employer_employee") return { sent: false, reason: "employer_matter" };
    const submittedSent = await EmailLog.findOne({ templateKey: ONLINE_TEMPLATE, caseId: caseDoc._id, status: { $in: ["sent", "queued"] } }).select("_id").lean();
    if (!submittedSent) return { sent: false, reason: "submitted_email_not_sent" };
    const alreadyThisNumber = await EmailLog.findOne({ templateKey: RECEIPT_TEMPLATE, caseId: caseDoc._id, "data.receiptNumber": number, status: { $in: ["sent", "queued"] } }).select("_id").lean();
    if (alreadyThisNumber) return { sent: false, reason: "already_sent" };
    const client = await recipientFor(caseDoc);
    if (!client) return { sent: false, reason: "no_client_login" };
    const { sendTemplateEmail } = require("../../modules/email/email.service");
    const result = await sendTemplateEmail(RECEIPT_TEMPLATE, {
      to: client.email,
      caseId: caseDoc._id,
      userId: client._id,
      recipientRole: client.role,
      triggeredBy: user?._id,
      data: { clientName: caseDoc.clientName || client.name || client.displayName, caseNumber: caseDoc.caseNumber, receiptNumber: number },
    });
    return { sent: Boolean(result?.sent), reason: result?.reason };
  } catch (error) {
    logger.warn("receipt_number_notice_failed", { caseId: String(caseId), error: error.message });
    return { sent: false, reason: "error" };
  }
}

const FEDEX_TEMPLATE = "case-fedex-number-client";
const cleanNumber = (value) => String(value ?? "").replace(/[\s-]+/g, "");

/**
 * The FedEx number was added or changed by the team. If the client already got the "case submitted" e-mail WITHOUT it, they get this separate e-mail with the number
 * and a pointer to the FedEx tracking area on their dashboard. Nothing is sent when:
 *   - the submitted e-mail has not been sent (the team chose not to inform the client, or it is still to be sent - the number then rides inside that e-mail);
 *   - the number is unchanged, or that exact number was already e-mailed for this case;
 *   - the case is an employer matter / has no client login (same rules as the submitted e-mail).
 * Fire and forget: never throws, never slows or fails the save.
 */
async function sendFedexNumberNotice({ caseId, trackingNumber, previous, user }) {
  try {
    const number = cleanNumber(trackingNumber);
    if (!number || number === cleanNumber(previous)) return { sent: false, reason: "unchanged" };
    const caseDoc = await Case.findById(caseId);
    if (!caseDoc) return { sent: false, reason: "case_not_found" };
    if (caseDoc.caseRole === "principal" && caseDoc.caseStructure === "employer_employee") return { sent: false, reason: "employer_matter" };
    const submittedSent = await EmailLog.findOne({ templateKey: TEMPLATE, caseId: caseDoc._id, status: { $in: ["sent", "queued"] } }).select("_id").lean();
    if (!submittedSent) return { sent: false, reason: "submitted_email_not_sent" };
    const alreadyThisNumber = await EmailLog.findOne({ templateKey: FEDEX_TEMPLATE, caseId: caseDoc._id, "data.trackingNumber": number, status: { $in: ["sent", "queued"] } }).select("_id").lean();
    if (alreadyThisNumber) return { sent: false, reason: "already_sent" };
    const client = await recipientFor(caseDoc);
    if (!client) return { sent: false, reason: "no_client_login" };
    const { sendTemplateEmail } = require("../../modules/email/email.service");
    const result = await sendTemplateEmail(FEDEX_TEMPLATE, {
      to: client.email,
      caseId: caseDoc._id,
      userId: client._id,
      recipientRole: client.role,
      triggeredBy: user?._id,
      data: { clientName: caseDoc.clientName || client.name || client.displayName, caseNumber: caseDoc.caseNumber, trackingNumber: number },
    });
    return { sent: Boolean(result?.sent), reason: result?.reason };
  } catch (error) {
    logger.warn("fedex_number_notice_failed", { caseId: String(caseId), error: error.message });
    return { sent: false, reason: "error" };
  }
}

module.exports = { notifySubmitted, sendSubmittedNotice, sendOnTeamChoice, sendFedexNumberNotice, sendReceiptNumberNotice, SUBMITTED_STAGE_KEY };
