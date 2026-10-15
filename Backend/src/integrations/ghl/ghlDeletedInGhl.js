// A card deleted in GoHighLevel deletes its case here (the other half of "delete in the software -> deleted in GHL", see
// ghlCaseOutbound.queueGhlOpportunityDeletions). Two steps so a glitch can never delete a real case:
//   1. sync finds the opportunity gone (404 from GHL's own lookup, only after EVERY pipeline was read in full, or a delete webhook) and FLAGS the
//      case with the time (flagDeletedInGhl);
//   2. a later pass (at least GHL_DELETE_CONFIRM_MS, default 2 minutes) asks GHL again; only if the opportunity is STILL gone is the case deleted
//      through the normal permanent-deletion path (files, accounts, linked records), without queueing a second GHL deletion.
// An opportunity that turns out to exist after all just clears the flag. GHL_DELETE_CASES_REMOVED_IN_GHL=false switches the deleting off
// (the cases are then only flagged, the previous behavior). THIS IS THE DEFAULT: the deleting only happens when
// GHL_DELETE_CASES_REMOVED_IN_GHL=true, because a real case must never be removed automatically.

const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const opportunityService = require("./ghlOpportunityService"); // by object, so tests can substitute the GHL calls
const { GHLApiError } = require("./ghlClient");
const { ghlSystemActor } = require("./ghlSystemActor");

const confirmMs = () => Number(process.env.GHL_DELETE_CONFIRM_MS || 2 * 60 * 1000);
// OFF unless explicitly switched on: no real case is ever deleted automatically. A card missing from GHL only FLAGS its case (needs attention);
// a person deletes the case here if they want it gone. Set GHL_DELETE_CASES_REMOVED_IN_GHL=true to turn automatic deleting on.
const isEnabled = () => process.env.GHL_DELETE_CASES_REMOVED_IN_GHL === "true";

/** Pure: has a flagged case waited long enough to be re-checked and (if still gone) deleted? */
function isReadyToConfirm(deletedInGhlAt, now = Date.now()) {
  if (!deletedInGhlAt) return false;
  return now - new Date(deletedInGhlAt).getTime() >= confirmMs();
}

/** Flags a case whose GHL opportunity is gone. The time is set once (the first sighting), so the confirmation delay counts from it. */
async function flagDeletedInGhl(caseId, now = new Date()) {
  await Case.updateOne({ _id: caseId }, { $set: { "integrations.ghl.flags.deletedInGhl": true, "integrations.ghl.flags.needsAttention": true } });
  await Case.updateOne({ _id: caseId, "integrations.ghl.flags.deletedInGhlAt": { $exists: false } }, { $set: { "integrations.ghl.flags.deletedInGhlAt": now } });
}

/** The opportunity is back / was never gone: forget the sighting. */
async function clearDeletedInGhl(caseId) {
  await Case.updateOne({ _id: caseId }, { $set: { "integrations.ghl.flags.deletedInGhl": false }, $unset: { "integrations.ghl.flags.deletedInGhlAt": "" } });
}

async function opportunityIsGone(opportunityId, client) {
  try {
    // getOpportunity(id, client): the client itself, or nothing for the shared one (NOT an options object)
    await (client ? opportunityService.getOpportunity(opportunityId, client) : opportunityService.getOpportunity(opportunityId));
    return false;
  } catch (error) {
    if (error instanceof GHLApiError && error.status === 404) return true;
    throw error; // any other error is NOT proof of deletion
  }
}

/**
 * Step 2. Deletes the cases whose GHL opportunity stayed gone. Call it after a COMPLETE reconcile pass only. Never throws.
 * Returns { checked, deleted, restored, errors }.
 */
async function deleteCasesRemovedInGhl({ client, now = Date.now() } = {}) {
  const result = { checked: 0, deleted: 0, restored: 0, errors: 0 };
  if (!isEnabled()) return result;
  try {
    const flagged = await Case.find({ "integrations.ghl.flags.deletedInGhl": true, "integrations.ghl.opportunityId": { $exists: true, $ne: null } })
      .select("_id caseNumber parentCase integrations.ghl.opportunityId integrations.ghl.flags.deletedInGhlAt")
      .lean();
    for (const item of flagged) {
      const flaggedAt = item.integrations?.ghl?.flags?.deletedInGhlAt;
      if (!flaggedAt) { await flagDeletedInGhl(item._id, new Date(now)); continue; } // flagged by an older version: start its confirmation delay now
      if (!isReadyToConfirm(flaggedAt, now)) continue;
      result.checked += 1;
      try {
        if (!(await opportunityIsGone(item.integrations.ghl.opportunityId, client))) {
          await clearDeletedInGhl(item._id);
          result.restored += 1;
          continue;
        }
        const caseDoc = await Case.findById(item._id);
        if (!caseDoc) continue;
        const parentId = caseDoc.parentCase;
        await require("../../modules/cases/case-deletion.service").requestCaseDeletion(caseDoc, ghlSystemActor(), { skipGhl: true });
        if (parentId) {
          // the employer matter's employee count follows the deletion (requestCaseDeletion only detaches the child from childCases)
          const remaining = await Case.countDocuments({ parentCase: parentId });
          await Case.updateOne({ _id: parentId }, { $set: { childCaseCount: remaining } });
        }
        result.deleted += 1;
        logger.info("ghl_case_deleted_removed_in_ghl", { caseNumber: item.caseNumber, opportunityId: item.integrations.ghl.opportunityId });
      } catch (error) {
        result.errors += 1;
        logger.warn("ghl_delete_removed_in_ghl_failed", { caseId: String(item._id), error: error.message });
      }
    }
  } catch (error) {
    logger.error("ghl_delete_removed_in_ghl_scan_failed", { error: error.message });
  }
  return result;
}

module.exports = { isReadyToConfirm, flagDeletedInGhl, clearDeletedInGhl, opportunityIsGone, deleteCasesRemovedInGhl, isEnabled };
