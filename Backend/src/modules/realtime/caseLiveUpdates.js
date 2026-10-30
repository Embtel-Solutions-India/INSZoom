// "Something on this case changed" - the one live signal that keeps the questionnaire answers, Required Documents, checklist approval and
// uploaded-documents sections of every open session on a case (Client portal, Admin, Attorney portal) in step.
//
// It carries NO case data - only { caseId, scope[], reason, at, actorId } - so a receiver always re-reads through its own authorized API. It goes to
// the people who can see the case (owner, delegate, every case manager, attorneys with active access, the employer of an employee case) plus the
// admin-level roles that see every case. Nothing here can fail or slow a save: calls are fire-and-forget, never throw, bursts of changes to one
// case (a multi-file upload, an autosave per keystroke) are coalesced into one event, and with no socket server running it is a no-op.
const logger = require("../../utils/logger");

const EVENT = "case:data_changed";
const COALESCE_MS = 250;
const ROLES = ["super_admin", "admin", "team_lead"];
const pending = new Map(); // caseId -> { scopes:Set, reason, actorId, timer }

const idOf = (value) => {
  const raw = value?._id || value;
  return raw ? String(raw) : "";
};

async function recipientsOf(caseId) {
  const Case = require("../../models/Case");
  const { allCaseManagerIds } = require("../cases/caseManagerAccess");
  const fields = "caseNumber user delegateEmployerUser assignedCaseManager additionalCaseManagers attorneyAccess parentCase";
  const caseData = await Case.findById(caseId).select(fields).lean();
  if (!caseData) return null;
  const ids = new Set([caseData.user, caseData.delegateEmployerUser, ...allCaseManagerIds(caseData)].map(idOf));
  for (const grant of caseData.attorneyAccess || []) if (grant?.status === "active") ids.add(idOf(grant.attorneyId));
  if (caseData.parentCase) {
    // an employee case: the employer (who holds the principal case) sees it in their Employees dashboard
    const parent = await Case.findById(caseData.parentCase).select("user delegateEmployerUser assignedCaseManager additionalCaseManagers attorneyAccess").lean();
    if (parent) {
      [parent.user, parent.delegateEmployerUser, ...allCaseManagerIds(parent)].forEach((id) => ids.add(idOf(id)));
      // the attorney granted the matter can open its slots, so hears about them too
      for (const grant of parent.attorneyAccess || []) if (grant?.status === "active") ids.add(idOf(grant.attorneyId));
    }
  }
  ids.delete("");
  return { caseNumber: caseData.caseNumber, userIds: [...ids] };
}

async function flush(caseId) {
  const entry = pending.get(caseId);
  pending.delete(caseId);
  if (!entry) return;
  try {
    const gateway = require("./realtime.gateway");
    const recipients = await recipientsOf(caseId);
    if (!recipients) return;
    const payload = { caseId, caseNumber: recipients.caseNumber, scope: [...entry.scopes], reason: entry.reason || "", actorId: entry.actorId, at: new Date().toISOString() };
    recipients.userIds.forEach((userId) => gateway.emitToUser(userId, EVENT, payload));
    ROLES.forEach((role) => gateway.emitToRole(role, EVENT, payload));
  } catch (error) {
    logger.error("case_live_update_failed", { caseId, error: error.message });
  }
}

// caseRefs: a case id / document / populated ref, or an array of them. scope: "answers" | "documents" | "checklist" (or an array).
function notifyCaseDataChanged(caseRefs, scope, { actor, reason } = {}) {
  try {
    const scopes = [].concat(scope).filter(Boolean);
    const caseIds = new Set([].concat(caseRefs).map(idOf).filter(Boolean));
    caseIds.forEach((caseId) => {
      const entry = pending.get(caseId) || { scopes: new Set(), reason: "", actorId: "", timer: null };
      scopes.forEach((name) => entry.scopes.add(name));
      if (reason) entry.reason = reason;
      if (actor) entry.actorId = idOf(actor);
      if (!entry.timer) {
        entry.timer = setTimeout(() => flush(caseId), COALESCE_MS);
        entry.timer.unref?.();
      }
      pending.set(caseId, entry);
    });
  } catch (error) {
    logger.error("case_live_update_failed", { error: error.message });
  }
}

// Sends everything waiting right now (used by tests and on shutdown paths).
async function flushPending() {
  const ids = [...pending.keys()];
  ids.forEach((caseId) => clearTimeout(pending.get(caseId)?.timer));
  await Promise.all(ids.map(flush));
}

module.exports = { EVENT, notifyCaseDataChanged, flushPending };
