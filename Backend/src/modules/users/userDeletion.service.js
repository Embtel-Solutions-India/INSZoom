// Permanent removal of a staff/attorney account. Distinct from deactivation
// (isActive=false, reversible, keeps the record): this deletes the User
// document and the records that only exist for that login.
//
// Refuses while the user is still assigned to cases - deleting would leave
// those cases pointing at a user that no longer exists. The caller is told
// how many so the cases can be reassigned first.
const mongoose = require("mongoose");
const User = require("../../models/User");
const Case = require("../../models/Case");
const AuthSession = require("../../models/AuthSession");
const { invalidateUserCache } = require("../../config/redis");

const CASE_ASSIGNMENT_FIELDS = ["assignedCaseManager", "assignedTeamLead", "primaryOwner", "secondaryOwner"];

async function countAssignedCases(userId) {
  return Case.countDocuments({
    $or: [
      ...CASE_ASSIGNMENT_FIELDS.map((field) => ({ [field]: userId })),
      { attorneyAccess: { $elemMatch: { attorneyId: userId, status: "active" } } },
    ],
  });
}

async function deleteUserPermanently(target) {
  const assigned = await countAssignedCases(target._id);
  if (assigned > 0) {
    const error = new Error(`${target.name || target.displayName || target.email} is still assigned to ${assigned} case${assigned === 1 ? "" : "s"}. Reassign ${assigned === 1 ? "it" : "them"} first, or deactivate this user instead.`);
    error.status = 409;
    throw error;
  }
  const userId = target._id;
  await AuthSession.deleteMany({ user: userId });
  for (const [name, fields] of [["Notification", ["user", "userId"]], ["DeviceToken", ["user", "userId"]]]) {
    const Model = mongoose.models[name];
    if (Model) await Model.deleteMany({ $or: fields.map((field) => ({ [field]: userId })) });
  }
  await User.deleteOne({ _id: userId });
  await invalidateUserCache(userId).catch(() => {});
}

module.exports = { deleteUserPermanently, countAssignedCases };
