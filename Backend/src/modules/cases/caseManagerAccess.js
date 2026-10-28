// A case can have several case managers: assignedCaseManager (the primary/lead, the only one a client sees) plus
// additionalCaseManagers[]. All of them have identical access to the case. This module is the single place that
// knows that shape - every access check, list filter, notification fan-out and report goes through it, so a
// future change to "who counts as a case manager of this case" is made here only.

const idOf = (value) => {
  const raw = value?._id || value;
  return raw ? String(raw) : "";
};

// Unique string ids of every case manager on the case (primary first). Works on documents, lean objects, populated or not.
function allCaseManagerIds(caseData) {
  const ids = [caseData?.assignedCaseManager, ...(caseData?.additionalCaseManagers || [])].map(idOf).filter(Boolean);
  return [...new Set(ids)];
}

function isCaseManagerOfCase(caseData, userOrId) {
  const id = idOf(userOrId);
  return Boolean(id) && allCaseManagerIds(caseData).includes(id);
}

// Mongo filter fragment: cases where `userId` is the primary OR an additional case manager.
function caseManagerMatch(userId) {
  return { $or: [{ assignedCaseManager: userId }, { additionalCaseManagers: userId }] };
}

// Same fragment for several manager ids ($in).
function caseManagersMatch(userIds) {
  return { $or: [{ assignedCaseManager: { $in: userIds } }, { additionalCaseManagers: { $in: userIds } }] };
}

// Client and beneficiary records attached to cases where the user is an ADDITIONAL case manager. The Client/Beneficiary
// lists scope a case manager by the record's own assignedCaseManager, which an additional case manager is never set on, so
// those lists union these ids in. Lazy require: this module stays free of model imports for everyone else.
async function additionalCaseRecordIds(userId) {
  const Case = require("../../models/Case");
  const match = { additionalCaseManagers: userId };
  const [clientIds, beneficiaryIds] = await Promise.all([Case.distinct("clientProfile", match), Case.distinct("beneficiary", match)]);
  return { clientIds: clientIds.filter(Boolean), beneficiaryIds: beneficiaryIds.filter(Boolean) };
}

// Select-string tail so a caller that .select()s a limited field list still carries what canAccessCase needs.
const CASE_MANAGER_SELECT = "assignedCaseManager additionalCaseManagers childCaseManagers";

// --- Child-scoped access -------------------------------------------------------------------------------------------------
// A case manager assigned to only some employee/beneficiary child cases of a matter may open the principal (employer) case,
// but sees only their own children inside it. "Scoped" = a case manager who is on a child but not on the principal itself.

const isCaseManagerRole = (user) => String(user?.role || "").toLowerCase().replace(/[\s-]+/g, "_") === "case_manager";

function isChildScopedCaseManager(principal, userOrId) {
  const id = idOf(userOrId);
  return Boolean(id) && (principal?.childCaseManagers || []).some((value) => idOf(value) === id);
}

// Recompute a principal's childCaseManagers from its live children. Never throws.
async function syncPrincipalChildManagers(principalId) {
  try {
    if (!principalId) return;
    const Case = require("../../models/Case");
    const children = await Case.find({ parentCase: principalId, status: { $ne: "removed" } }).select("assignedCaseManager additionalCaseManagers").lean();
    const ids = [...new Set(children.flatMap(allCaseManagerIds))];
    await Case.updateOne({ _id: principalId }, { $set: { childCaseManagers: ids } }, { timestamps: false });
  } catch (error) {
    console.error("[childCaseManagers] sync failed (non-fatal):", error.message);
  }
}

// If `user` is a case manager on one of this principal's children but not yet recorded on it (assignments made before this
// field existed, or a path that skipped the sync), record them. Returns true when they now have scoped access.
async function healChildScope(principal, user) {
  if (!isCaseManagerRole(user) || principal?.caseRole !== "principal") return false;
  if (isChildScopedCaseManager(principal, user)) return true;
  const Case = require("../../models/Case");
  const has = await Case.exists({ parentCase: principal._id, ...caseManagerMatch(user._id) });
  if (!has) return false;
  await Case.updateOne({ _id: principal._id }, { $addToSet: { childCaseManagers: user._id } }, { timestamps: false });
  principal.childCaseManagers = [...(principal.childCaseManagers || []), user._id];
  return true;
}

// null = the user sees every child of this principal; otherwise the ids of the only children they may see.
async function scopedChildIdsFor(principal, user) {
  if (!isCaseManagerRole(user) || principal?.caseRole !== "principal") return null;
  if (isCaseManagerOfCase(principal, user._id) || idOf(principal.primaryOwner) === idOf(user._id) || idOf(principal.secondaryOwner) === idOf(user._id)) return null;
  if (!isChildScopedCaseManager(principal, user)) return null;
  const Case = require("../../models/Case");
  return Case.find({ parentCase: principal._id, ...caseManagerMatch(user._id) }).distinct("_id");
}

module.exports = {
  idOf, allCaseManagerIds, isCaseManagerOfCase, caseManagerMatch, caseManagersMatch, additionalCaseRecordIds, CASE_MANAGER_SELECT,
  isChildScopedCaseManager, syncPrincipalChildManagers, healChildScope, scopedChildIdsFor,
};
