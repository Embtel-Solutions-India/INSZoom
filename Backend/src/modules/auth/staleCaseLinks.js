// A client account can keep a link (primaryCaseId / caseIds) to a case that no longer exists in the live collection - a case that was deleted (it is in the recycle bin) by a
// path that left the account behind. Such a link must neither block a new case for the same email nor win the client's landing case. This drops only the links whose case is
// gone; a link to a live case is never touched. Fail-safe: never throws, and on any problem it leaves the account exactly as it was.
const logger = require("../../utils/logger");

/**
 * @param user  a User document (or a plain object with _id, primaryCaseId, caseIds); updated in memory when links are dropped
 * @param deps  { CaseModel, UserModel } - injectable for tests
 * @returns the same user
 */
async function pruneStaleCaseLinks(user, deps = {}) {
  try {
    if (!user) return user;
    const CaseModel = deps.CaseModel || require("../../models/Case");
    const UserModel = deps.UserModel || require("../../models/User");
    const linked = [user.primaryCaseId, ...(user.caseIds || [])].filter(Boolean);
    if (!linked.length) return user;
    // a withdrawn (status "removed") case is no longer the account's case either
    const live = new Set((await CaseModel.find({ _id: { $in: linked }, status: { $ne: "removed" } }).select("_id").lean()).map((item) => String(item._id)));
    const keptIds = (user.caseIds || []).filter((id) => live.has(String(id)));
    const primaryLive = !user.primaryCaseId || live.has(String(user.primaryCaseId));
    if (keptIds.length === (user.caseIds || []).length && primaryLive) return user;
    await UserModel.updateOne({ _id: user._id }, { $set: { caseIds: keptIds }, ...(primaryLive ? {} : { $unset: { primaryCaseId: "" } }) });
    user.caseIds = keptIds;
    if (!primaryLive) user.primaryCaseId = undefined;
    logger.info("stale_case_links_pruned", { userId: String(user._id), kept: keptIds.length, primaryDropped: !primaryLive });
  } catch (error) {
    logger.warn("stale_case_links_prune_failed", { error: error.message });
  }
  return user;
}

const CLIENT_SIDE_ROLES = ["client", "employee", "employer", "beneficiary"];

/**
 * A client-side account (client / employee / employer / beneficiary) that no longer has ANY live case is just a leftover of a deleted case. Its email is free again, so the account
 * takes the role the new case needs instead of refusing with "that email belongs to another account type". Staff, attorney and admin accounts are never touched, and an account that
 * still has a live case keeps its role. `exceptCaseId` is the case being worked on (its own links do not count). Returns true when the account now holds `newRole`.
 */
async function reclaimOrphanClientSideAccount(user, newRole, { exceptCaseId, ...deps } = {}) {
  try {
    if (!user || !CLIENT_SIDE_ROLES.includes(user.role) || !CLIENT_SIDE_ROLES.includes(newRole)) return false;
    if (user.role === newRole) return true;
    const CaseModel = deps.CaseModel || require("../../models/Case");
    const UserModel = deps.UserModel || require("../../models/User");
    const id = user._id;
    const live = await CaseModel.exists({
      status: { $ne: "removed" }, // a withdrawn employee's case releases the email
      ...(exceptCaseId ? { _id: { $ne: exceptCaseId } } : {}),
      $or: [{ user: id }, { employerUser: id }, { employeeUser: id }, { delegateEmployerUser: id }, { petitionerUser: id }, { beneficiaryUser: id }, { clientProfile: id }, ...(user.email ? [{ clientEmail: user.email }] : [])],
    });
    if (live) return false;
    await UserModel.updateOne({ _id: id }, { $set: { role: newRole, caseIds: [] }, $unset: { primaryCaseId: "", principalCaseId: "", caseRole: "" } });
    user.role = newRole;
    user.caseIds = [];
    user.primaryCaseId = undefined;
    user.principalCaseId = undefined;
    user.caseRole = undefined;
    logger.info("orphan_account_reclaimed", { userId: String(id), role: newRole });
    return true;
  } catch (error) {
    logger.warn("orphan_account_reclaim_failed", { error: error.message });
    return false;
  }
}

/**
 * Frees the email of a person whose every case was withdrawn (a removed employee / beneficiary) or deleted, so it can be used for a NEW case: the account takes the role the new
 * case needs and its dead links to the withdrawn cases are dropped. An account that still has a live case is left exactly as it is (the email is genuinely in use), and so are
 * staff / attorney / admin accounts. `fromRoles` limits which current roles may be freed (e.g. only a leftover employee, never a client who simply has no case yet).
 * Fail-safe like the two helpers it combines: never throws, always returns the user.
 */
async function releaseLeftoverAccount(user, newRole, { fromRoles, ...deps } = {}) {
  try {
    if (!user) return user;
    if (fromRoles && !fromRoles.includes(user.role)) return user;
    await reclaimOrphanClientSideAccount(user, newRole, deps);
    await pruneStaleCaseLinks(user, deps);
  } catch (error) {
    logger.warn("leftover_account_release_failed", { error: error.message });
  }
  return user;
}

module.exports = { pruneStaleCaseLinks, reclaimOrphanClientSideAccount, releaseLeftoverAccount };
