const EmployerProfile = require("../../models/EmployerProfile");
const Case = require("../../models/Case");
const { validateFieldPaths, buildCanonicalUpdate, resolveCanonicalWriteSource } = require("../../utils/canonicalFieldWriter");

const STAFF_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);
const RESTRICTED_PORTAL_ROLES = new Set(["employee", "beneficiary"]);

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

function canonicalValue(profile, path) {
  return path.split(".").reduce((current, key) => current?.[key], profile?.canonicalData)?.value || "";
}

function summarizeEmployerProfile(profile) {
  if (!profile) return null;
  return {
    legalName: canonicalValue(profile, "legalName"),
    dbaName: canonicalValue(profile, "dbaName"),
    primaryContact: {
      name: canonicalValue(profile, "contact.name"),
      title: canonicalValue(profile, "contact.title"),
      email: canonicalValue(profile, "contact.email"),
      phone: canonicalValue(profile, "contact.phone"),
    },
  };
}

// INVARIANT 1: EmployerProfile has exactly one full read/write path. Invited
// employee/beneficiary accounts use getEmployerProfileSummaryForUser() for a
// minimized read-only summary and never receive the full EmployerProfile.
async function canRead(principalCaseId, user) {
  if (STAFF_ROLES.has(user.role)) return true;
  if (RESTRICTED_PORTAL_ROLES.has(user.role)) return false;
  const ids = userCaseIdSet(user);
  if (ids.has(String(principalCaseId))) return true;
  return false;
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

async function getEmployerProfileSummaryForUser(user) {
  if (!RESTRICTED_PORTAL_ROLES.has(user.role)) throw forbiddenError("Access denied");
  const ids = [...userCaseIdSet(user)];
  if (!ids.length) throw forbiddenError("Access denied");
  const childCase = await Case.findOne({
    _id: { $in: ids },
    caseRole: user.role,
    ...(user.principalCaseId ? { parentCase: user.principalCaseId } : {}),
  }).select("_id parentCase caseRole").lean();
  if (!childCase?.parentCase) throw forbiddenError("Access denied");
  const profile = await EmployerProfile.findOne({ principalCaseId: childCase.parentCase }).lean();
  return summarizeEmployerProfile(profile);
}

async function upsertEmployerProfile(principalCaseId, fields, source, user, options = {}) {
  const principal = await Case.findById(principalCaseId).select("_id caseRole");
  if (!principal) throw notFoundError("Case not found");
  if (!(await canWrite(principalCaseId, user))) {
    throw forbiddenError("Only the employer (or staff) may update employer data");
  }

  const invalidPaths = validateFieldPaths(EmployerProfile, fields);
  if (invalidPaths.length) throw badRequestError(`Unknown employer field(s): ${invalidPaths.join(", ")}`);

  const existingDoc = await EmployerProfile.findOne({ principalCaseId });
  const effectiveSource = resolveCanonicalWriteSource(user, source);
  const { setOps, incOps, pushOps, applied, conflicted } = buildCanonicalUpdate({
    Model: EmployerProfile,
    existingDoc,
    fields,
    source: effectiveSource,
    userId: user._id,
    sourceId: options.sourceId,
    sourceFieldPrefix: options.sourceFieldPrefix || "employer",
    sourceFields: options.sourceFields,
    expectedRevisions: options.expectedRevisions,
    profileOwner: "employer",
    caseScope: { principalCaseId: String(principalCaseId) },
    changeId: options.changeId,
    reason: options.reason,
  });

  const updated = await EmployerProfile.findOneAndUpdate(
    { principalCaseId },
    {
      $set: setOps,
      ...(Object.keys(incOps).length ? { $inc: incOps } : {}),
      ...(Object.keys(pushOps).length ? { $push: pushOps } : {}),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await Case.updateOne(
    { _id: principalCaseId },
    {
      $set: {
        "questionnaireData.lastSubmittedAt": new Date(),
        "questionnaireData.progress.employerProfileSubmitted": true,
        "questionnaireData.progress.profileSubmitted": true,
      },
    }
  );

  return { profile: updated, applied, conflicted, source: effectiveSource };
}

module.exports = { getEmployerProfile, getEmployerProfileSummaryForUser, upsertEmployerProfile };
