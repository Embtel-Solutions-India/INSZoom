// Permanent case deletion. Unlike archiveCase (reversible, keeps every record), this removes the case from the database
// together with everything that only exists for it: answers, documents (and their stored files), forms, tasks, messages,
// notifications, audit rows, ... Deleting a principal case also deletes its child cases (they cannot exist without it).
// A client/employee account is removed only when this leaves it with no case at all; staff and attorney accounts are
// never touched.
//
// Every collection is swept by the same reference fields, so a collection added later is covered without changing this file.
const mongoose = require("mongoose");
const Case = require("../../models/Case");
const User = require("../../models/User");
const logger = require("../../utils/logger");

const CASE_FIELDS = ["caseId", "case", "caseRef", "parentCaseId", "principalCaseId", "relatedCaseId"];
const USER_FIELDS = ["user", "userId", "clientId", "clientUserId", "recipient", "recipientId"];
const EMAIL_FIELDS = ["email", "clientEmail", "to", "emailTo", "userEmail"];
const CLIENT_SIDE_ROLES = ["client", "employee", "employer", "beneficiary"];
const SKIPPED_COLLECTIONS = new Set(["users", "cases", "leads", "system.profile"]);

const ids = (list) => list.map((value) => new mongoose.Types.ObjectId(String(value)));

async function collectTargets(caseData) {
  const children = await Case.find({ $or: [{ parentCase: caseData._id }, { _id: { $in: caseData.childCases || [] } }] }).select("_id caseNumber user").lean();
  const cases = [{ _id: caseData._id, caseNumber: caseData.caseNumber, user: caseData.user }, ...children.filter((child) => String(child._id) !== String(caseData._id))];
  return { cases, caseIds: ids(cases.map((item) => item._id)) };
}

// Client-side accounts that would be left with no case once `caseIds` are gone.
async function orphanedClientUsers(cases, caseIds) {
  const candidateIds = [...new Set(cases.map((item) => item.user).filter(Boolean).map(String))];
  if (!candidateIds.length) return [];
  const users = await User.find({ _id: { $in: ids(candidateIds) }, role: { $in: CLIENT_SIDE_ROLES } }).select("_id email").lean();
  const orphans = [];
  for (const user of users) {
    const remaining = await Case.countDocuments({ _id: { $nin: caseIds }, $or: [{ user: user._id }, { clientEmail: user.email }, { employerUser: user._id }, { employeeUser: user._id }] });
    if (!remaining) orphans.push(user);
  }
  return orphans;
}

async function deleteCasePermanently(caseData, actor) {
  const db = mongoose.connection.db;
  const { cases, caseIds } = await collectTargets(caseData);
  const orphans = await orphanedClientUsers(cases, caseIds);
  const userIds = orphans.map((user) => user._id);
  const emails = orphans.map((user) => user.email).filter(Boolean);

  // stored files first: once the Document rows are gone nothing else knows their keys
  const documents = await db.collection("documents").find({ caseId: { $in: caseIds } }).project({ storageKey: 1, versions: 1 }).toArray();
  const keys = new Set();
  documents.forEach((doc) => [doc.storageKey, ...(doc.versions || []).map((version) => version.storageKey)].filter(Boolean).forEach((key) => keys.add(key)));
  const storage = require("../uploads/storage.service");
  let filesRemoved = 0;
  for (const key of keys) {
    await storage.deleteObject(key).then(() => { filesRemoved += 1; }).catch((error) => logger.error("case_delete_storage_failed", { key, error: error.message }));
  }

  const collections = (await db.listCollections().toArray()).map((entry) => entry.name).filter((name) => !SKIPPED_COLLECTIONS.has(name));
  const removed = {};
  for (const name of collections) {
    const or = CASE_FIELDS.map((field) => ({ [field]: { $in: caseIds } }));
    if (userIds.length) USER_FIELDS.forEach((field) => or.push({ [field]: { $in: userIds } }));
    if (emails.length) EMAIL_FIELDS.forEach((field) => or.push({ [field]: { $in: emails } }));
    const result = await db.collection(name).deleteMany({ $or: or }).catch(() => null);
    if (result?.deletedCount) removed[name] = result.deletedCount;
  }

  // detach from anything that still points at the deleted cases
  await Case.updateMany({ childCases: { $in: caseIds } }, { $pull: { childCases: { $in: caseIds } } });
  await User.updateMany({ caseIds: { $in: caseIds } }, { $pull: { caseIds: { $in: caseIds } } });
  await User.updateMany({ primaryCaseId: { $in: caseIds } }, { $unset: { primaryCaseId: "" } });

  await Case.deleteMany({ _id: { $in: caseIds } });
  if (userIds.length) await User.deleteMany({ _id: { $in: userIds }, role: { $in: CLIENT_SIDE_ROLES } });

  logger.info("case_deleted_permanently", {
    by: String(actor?._id || ""),
    caseNumbers: cases.map((item) => item.caseNumber),
    accountsRemoved: orphans.length,
    filesRemoved,
    removed,
  });
  return { caseNumbers: cases.map((item) => item.caseNumber), accountsRemoved: orphans.length, filesRemoved, removed };
}

module.exports = { deleteCasePermanently };
