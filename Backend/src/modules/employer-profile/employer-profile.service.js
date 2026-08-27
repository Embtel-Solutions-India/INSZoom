const EmployerProfile = require("../../models/EmployerProfile");
const Case = require("../../models/Case");
const { validateFieldPaths, buildCanonicalUpdate } = require("../../utils/canonicalFieldWriter");

const STAFF_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}
function forbiddenError(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}
function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function userCaseIdSet(user) {
  return new Set([...(user.caseIds || []), user.primaryCaseId].filter(Boolean).map(String));
}

// INVARIANT 1: EmployerProfile has exactly one write path (upsertEmployerProfile
// below). Read access is broader than write access — an invited employee may
// read the employer's profile (for the read-only summary shown in their own
// tab) but may never write it.
async function canRead(principalCaseId, user) {
  if (STAFF_ROLES.has(user.role)) return true;
  const ids = userCaseIdSet(user);
  if (ids.has(String(principalCaseId))) return true;
  // Any child case (an invited employee) belonging to this principal, that
  // the requester happens to own, also grants read access to the employer
  // summary — this is what powers the read-only employer block on each
  // employee's own questionnaire tab.
  return Boolean(await Case.exists({ _id: { $in: [...ids] }, parentCase: principalCaseId }));
}

async function canWrite(principalCaseId, user) {
  if (STAFF_ROLES.has(user.role)) return true;
  return userCaseIdSet(user).has(String(principalCaseId));
}

async function getEmployerProfile(principalCaseId, user) {
  const principal = await Case.findById(principalCaseId).select("_id");
  if (!principal) throw notFoundError("Case not found");
  if (!(await canRead(principalCaseId, user))) throw forbiddenError("Access denied");
  return EmployerProfile.findOne({ principalCaseId }).lean();
}

async function upsertEmployerProfile(principalCaseId, fields, source, user) {
  const principal = await Case.findById(principalCaseId).select("_id caseRole");
  if (!principal) throw notFoundError("Case not found");
  if (!(await canWrite(principalCaseId, user))) {
    throw forbiddenError("Only the employer (or staff) may update employer data");
  }

  const invalidPaths = validateFieldPaths(EmployerProfile, fields);
  if (invalidPaths.length) throw badRequestError(`Unknown employer field(s): ${invalidPaths.join(", ")}`);

  const existingDoc = await EmployerProfile.findOne({ principalCaseId });
  const { setOps, incOps, applied, conflicted } = buildCanonicalUpdate({
    Model: EmployerProfile,
    existingDoc,
    fields,
    source,
    userId: user._id,
  });

  const updated = await EmployerProfile.findOneAndUpdate(
    { principalCaseId },
    { $set: setOps, ...(Object.keys(incOps).length ? { $inc: incOps } : {}) },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return { profile: updated, applied, conflicted };
}

module.exports = { getEmployerProfile, upsertEmployerProfile };
