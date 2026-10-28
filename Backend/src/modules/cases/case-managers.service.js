const Case = require("../../models/Case");
const User = require("../../models/User");
const { normalizeRole } = require("../authorization/roleHierarchy");
const caseService = require("./case.service");
const { idOf, isCaseManagerOfCase, syncPrincipalChildManagers } = require("./caseManagerAccess");

// Additional case managers on a case (see caseManagerAccess.js). Pure data operations - HTTP, notifications and realtime
// live in case-managers.controller.js. The primary case manager (assignedCaseManager) is still changed through the
// existing assign-case-manager flow; nothing here touches it.

// The assignable pool is exactly the users holding the case_manager role.
async function findAssignableCaseManager(userId) {
  const user = await User.findById(userId).select("_id name displayName email role isActive");
  if (!user || user.isActive === false) return { error: "Case manager was not found or is inactive" };
  if (normalizeRole(user.role) !== "case_manager") return { error: "Selected user does not hold the case manager role" };
  return { user };
}

// Mutates (does not save) the case. Returns { error } for a rejected request, { changed: true } otherwise.
function addAdditionalCaseManager(caseData, userId, actor, notes) {
  if (isCaseManagerOfCase(caseData, userId)) return { error: "This person is already a case manager on this case" };
  caseData.additionalCaseManagers = [...(caseData.additionalCaseManagers || []), userId];
  caseData.assignmentHistory.push({ assignedTo: userId, assignedBy: actor?._id, role: "case_manager", notes: notes || "Added as additional case manager", changeType: "assigned" });
  caseService.addTimelineEvent(caseData, "assignment", "Case Manager Added", "An additional case manager was added to the case", actor, { role: "case_manager", additional: true, assignedTo: userId });
  caseService.addAuditEntry(caseData, "add_case_manager", "Additional case manager added", actor, { assignedTo: userId });
  return { changed: true };
}

function removeAdditionalCaseManager(caseData, userId, actor) {
  const isAdditional = (caseData.additionalCaseManagers || []).some((id) => idOf(id) === idOf(userId));
  if (!isAdditional) {
    return { error: isCaseManagerOfCase(caseData, userId) ? "The primary case manager cannot be removed here - reassign the case instead" : "This person is not an additional case manager on this case" };
  }
  caseData.additionalCaseManagers = caseData.additionalCaseManagers.filter((id) => idOf(id) !== idOf(userId));
  caseData.assignmentHistory.push({ previousAssignedTo: userId, assignedBy: actor?._id, role: "case_manager", notes: "Removed as additional case manager", changeType: "removed" });
  caseService.addTimelineEvent(caseData, "assignment", "Case Manager Removed", "An additional case manager was removed from the case", actor, { role: "case_manager", additional: true, previousAssignedTo: userId });
  caseService.addAuditEntry(caseData, "remove_case_manager", "Additional case manager removed", actor, { previousAssignedTo: userId });
  return { changed: true };
}

// When a case manager is promoted to primary, they must not also sit in the additional list.
function dropFromAdditional(caseData, userId) {
  if (!(caseData.additionalCaseManagers || []).some((id) => idOf(id) === idOf(userId))) return;
  caseData.additionalCaseManagers = caseData.additionalCaseManagers.filter((id) => idOf(id) !== idOf(userId));
}

// A principal case's team applies to its child cases too, except children individually overridden (same rule as the
// primary case manager cascade). Runs after the principal's own save; failures are the caller's to log, never to roll back.
async function cascadeToChildren(principalCase, userId, op) {
  if (principalCase.caseRole !== "principal") return 0;
  const update = op === "add" ? { $addToSet: { additionalCaseManagers: userId } } : { $pull: { additionalCaseManagers: userId } };
  const result = await Case.updateMany({ parentCase: principalCase._id, assignmentOverridden: { $ne: true } }, update);
  syncPrincipalChildManagers(principalCase._id);
  return result.modifiedCount || 0;
}

module.exports = { findAssignableCaseManager, addAdditionalCaseManager, removeAdditionalCaseManager, dropFromAdditional, cascadeToChildren };
