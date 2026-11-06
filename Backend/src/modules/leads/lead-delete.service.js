// Deleting a lead for good. If the lead has a card in the GoHighLevel "Immiglance Pipeline", that card is deleted FIRST; if GoHighLevel cannot be reached the
// lead is kept and the person is told to retry (so a lead is never removed here while its card lives on there). The reverse (a card deleted in
// GoHighLevel) arrives through the webhook and calls removeLeadLocally directly.
const Lead = require("../../models/Lead");
const User = require("../../models/User");
const logger = require("../../utils/logger");

const SENDING_WINDOW_MS = 3 * 60 * 1000;

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

// The lead and the small records that point at it. Never throws for the pointers: the lead itself is what matters.
async function removeLeadLocally(leadId) {
  await User.updateMany({ leadId }, { $set: { leadId: null } }).catch((error) => logger.warn("lead_delete_user_unlink_failed", { leadId: String(leadId), error: error.message }));
  try { await require("../../models/StrategyCallQueueItem").deleteMany({ leadId }); } catch (error) { logger.warn("lead_delete_queue_cleanup_failed", { leadId: String(leadId), error: error.message }); }
  const result = await Lead.deleteOne({ _id: leadId });
  return result.deletedCount > 0;
}

async function deleteLead(leadId, actor) {
  const lead = await Lead.findById(leadId).select("fullName email leadNumber ghl").lean();
  if (!lead) throw httpError(404, "Lead not found");
  const ghl = require("../../integrations/ghl/ghlLeadPipeline");

  // being sent to GoHighLevel right now: deleting now could leave its card behind
  const sending = lead.ghl?.status === "syncing" && !lead.ghl?.opportunityId && lead.ghl?.claimedAt && Date.now() - new Date(lead.ghl.claimedAt).getTime() < SENDING_WINDOW_MS;
  if (sending) throw httpError(409, "This lead is being sent to GoHighLevel right now. Try again in a minute.", "LEAD_SYNC_IN_PROGRESS");

  try {
    await ghl.deleteCardFor(lead);
  } catch (error) {
    logger.warn("lead_delete_ghl_failed", { leadId: String(leadId), error: error.message });
    throw httpError(502, "The card could not be deleted in GoHighLevel, so the lead was kept. Try again in a moment.", "GHL_DELETE_FAILED");
  }
  await removeLeadLocally(lead._id);
  logger.info("lead_deleted", { leadId: String(lead._id), leadNumber: lead.leadNumber, by: actor?._id ? String(actor._id) : undefined, hadGhlCard: Boolean(lead.ghl?.opportunityId) });
  return { deleted: true, leadNumber: lead.leadNumber };
}

module.exports = { deleteLead, removeLeadLocally };
