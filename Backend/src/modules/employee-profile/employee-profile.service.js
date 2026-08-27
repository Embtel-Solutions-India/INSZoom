const EmployeeProfile = require("../../models/EmployeeProfile");
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

// INVARIANT 2: each EmployeeProfile has exactly one write path (below),
// bound to exactly one child case. There is deliberately no broader
// "any sibling" or "any employer" read/write grant here — only the caller
// who actually owns :caseId (the employer, while it's still in their own
// caseIds under fill_self mode, or the employee themselves once invited
// and activated) or staff may touch this specific profile.
async function canAccess(caseId, user) {
  if (STAFF_ROLES.has(user.role)) return true;
  return userCaseIdSet(user).has(String(caseId));
}

async function getEmployeeProfile(caseId, user) {
  const childCase = await Case.findById(caseId).select("_id caseRole");
  if (!childCase) throw notFoundError("Case not found");
  if (!(await canAccess(caseId, user))) throw forbiddenError("Access denied");
  return EmployeeProfile.findOne({ caseId }).lean();
}

async function upsertEmployeeProfile(caseId, fields, source, user) {
  const childCase = await Case.findById(caseId).select("_id caseRole");
  if (!childCase) throw notFoundError("Case not found");
  if (!["employee", "beneficiary"].includes(childCase.caseRole)) {
    throw badRequestError("This case is not a child (employee/beneficiary) case");
  }
  if (!(await canAccess(caseId, user))) throw forbiddenError("Access denied");

  const invalidPaths = validateFieldPaths(EmployeeProfile, fields);
  if (invalidPaths.length) throw badRequestError(`Unknown employee field(s): ${invalidPaths.join(", ")}`);

  // Do NOT upsert — the profile is guaranteed to already exist, created
  // alongside the child Case itself in case.controller.js's createCase.
  // Its absence here means data was corrupted upstream, not that this is
  // a legitimately-new profile to silently create.
  const existingDoc = await EmployeeProfile.findOne({ caseId });
  if (!existingDoc) throw notFoundError("Employee profile not found for this case");

  const { setOps, incOps, applied, conflicted } = buildCanonicalUpdate({
    Model: EmployeeProfile,
    existingDoc,
    fields,
    source,
    userId: user._id,
  });

  const updated = await EmployeeProfile.findOneAndUpdate(
    { caseId },
    { $set: setOps, ...(Object.keys(incOps).length ? { $inc: incOps } : {}) },
    { new: true }
  );

  return { profile: updated, applied, conflicted };
}

module.exports = { getEmployeeProfile, upsertEmployeeProfile };
