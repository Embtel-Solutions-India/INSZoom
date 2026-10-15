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
const CASE_MANAGER_SELECT = "assignedCaseManager additionalCaseManagers";

module.exports = { idOf, allCaseManagerIds, isCaseManagerOfCase, caseManagerMatch, caseManagersMatch, additionalCaseRecordIds, CASE_MANAGER_SELECT };
