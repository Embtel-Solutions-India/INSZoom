// One client login, many cases (docs/MULTI_CASE_CLIENTS_PLAN.md, Phase 1).
//
// A person keeps ONE User (unique email, same password / Google login / invites). Each case stays its own record; the person's User only lists the
// cases it is linked to (`caseIds`) and a default landing case (`primaryCaseId`). Access to a case is still decided per case by the case's own
// relation fields (case.service.js canAccessCase) - never by these lists and never by an e-mail match.
//
// Rules (shared by every creation path that adds a case to an EXISTING person):
//   - append, never replace: an earlier case is never dropped from `caseIds`
//   - `primaryCaseId` (the landing case) stays where it is; it is set only when the person has none
//   - the person-level `caseRole` / `principalCaseId` describe the FIRST case and are left as they are for a person who already has cases
//   - MULTI_CASE_CLIENTS=false switches all of this off: staff get the old "already linked to a case" refusal again
const Case = require("../../models/Case");

const LIVE = { status: { $ne: "removed" } };
const idOf = (value) => (value && value._id ? String(value._id) : value ? String(value) : "");

function multiCaseClientsEnabled(env = process.env) {
  return String(env.MULTI_CASE_CLIENTS ?? "true").trim().toLowerCase() !== "false";
}

/** Pure: a case id the client portal asked for (`?caseId=` / body), or null. Only a well-formed id; access is still checked by the caller. */
function requestedCaseId(value) {
  const id = String(Array.isArray(value) ? value[0] : value || "").trim();
  return /^[a-f0-9]{24}$/i.test(id) ? id : null;
}

/** Pure: the existing ids followed by the new ones, each once, order kept (earlier cases first). */
function mergeCaseIds(existing = [], added = []) {
  const seen = new Set();
  const out = [];
  for (const value of [...(existing || []), ...(added || [])]) {
    const key = idOf(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Pure: can this person already sign in? A password, OR an active account with no pending invitation (a Google sign-in account has no password but
 * a working login - the same signal auth.service.js checkEmail uses). Such a person must never get a new set-password link or be made inactive.
 */
const hasWorkingLogin = (user) => Boolean(user?.password) || Boolean(user && user.isActive !== false && !user.mustSetPassword && !user.inviteTokenHash);

/**
 * Pure: should a NEW case for this existing person come with a set-password invitation? Only for someone with no working login AND no other case.
 * A returning person (another case on the same login) always gets the "case created - log in" e-mail with their existing details; one who never
 * finished activating is offered "resend invitation" by the login page itself.
 */
const needsSetPasswordInvite = (user, { hadCase = false } = {}) => !hadCase && !hasWorkingLogin(user) && !user?.inviteTokenHash;

/** Pure: does this person already have a case linked (after stale links were pruned)? */
const hasLinkedCase = (user) => Boolean(user?.primaryCaseId || (user?.caseIds || []).length);

/**
 * Pure: the link fields to write on an EXISTING person who is getting `newCaseIds` (the new principal first, then its children).
 * `firstCaseFields` are the values a person with no case gets (caseRole / principalCaseId of the new case).
 */
function planExistingPersonLinks(user, newCaseIds, firstCaseFields = {}, { enabled = true } = {}) {
  const ids = (newCaseIds || []).filter(Boolean);
  if (!enabled || !hasLinkedCase(user)) {
    // a person with no live case (or the switch is off): exactly the old behaviour - the new case becomes everything
    return { primaryCaseId: ids[0], caseIds: ids, ...firstCaseFields };
  }
  return {
    primaryCaseId: user.primaryCaseId || ids[0],
    caseIds: mergeCaseIds(user.caseIds, ids),
    // caseRole / principalCaseId left untouched: they describe the person's first case
  };
}

const PERSON_FIELDS = ["user", "employerUser", "petitionerUser", "beneficiaryUser", "employeeUser", "delegateEmployerUser"];
const CAPACITY = { employerUser: "employer", petitionerUser: "petitioner", beneficiaryUser: "beneficiary", employeeUser: "employee", delegateEmployerUser: "employer (delegate)", user: "client" };
const CASE_FIELDS = "caseNumber clientName clientEmail visaType visaCategory status stage caseStructure caseRole parentCase createdAt updatedAt " + PERSON_FIELDS.join(" ");

/** Pure: how this person is on this case (first match, most specific first). */
function capacityOf(caseRow, userId) {
  const id = String(userId);
  for (const field of ["employerUser", "petitionerUser", "beneficiaryUser", "employeeUser", "delegateEmployerUser", "user"]) {
    if (idOf(caseRow[field]) === id) return CAPACITY[field];
  }
  return "client";
}

/**
 * Every live case a person is on, for staff screens: their own matters and, for an employee / beneficiary, the case they are on inside someone
 * else's matter. An employer's employee child cases are NOT listed separately (they sit inside the employer's matter).
 */
async function listPersonCases(userId, { CaseModel = Case } = {}) {
  if (!userId) return [];
  const id = String(userId);
  const rows = await CaseModel.find({ ...LIVE, $or: PERSON_FIELDS.map((field) => ({ [field]: userId })) })
    .select(CASE_FIELDS).sort({ createdAt: 1 }).limit(200).lean();
  return rows
    .filter((row) => !row.parentCase || idOf(row.employeeUser) === id || idOf(row.beneficiaryUser) === id)
    .map((row) => ({
      _id: String(row._id),
      caseNumber: row.caseNumber || "",
      visaType: row.visaType || row.visaCategory || "",
      status: row.status || "",
      stage: row.stage || "",
      caseStructure: row.caseStructure || "",
      capacity: capacityOf(row, id),
      clientName: row.clientName || "",
      clientEmail: row.clientEmail || "",
      createdAt: row.createdAt,
    }));
}

module.exports = { requestedCaseId, multiCaseClientsEnabled, mergeCaseIds, hasWorkingLogin, needsSetPasswordInvite, hasLinkedCase, planExistingPersonLinks, capacityOf, listPersonCases, PERSON_FIELDS };
