// One login, many cases - Phase 2B (docs/MULTI_CASE_CLIENTS_PLAN.md).
//
// An employee / beneficiary login keeps its stored role, so the case it was invited to works exactly as before. When the same person also has a case
// of their OWN (they are its client / petitioner / employer) and opens it in the client portal's switcher, the portal sends `X-Active-Case: <id>`.
// For that request only, and only after this check, the person acts as a CLIENT - every client feature on their own case.
//
// Rules (fail-safe: any doubt -> the stored role, exactly as today):
//   - only for a stored role of "employee" / "beneficiary"; everyone else is untouched
//   - the case must exist, not be removed, and have this person as user / petitionerUser / employerUser / delegateEmployerUser
//   - it must NOT be a case where they are the employee / beneficiary (that case keeps the restricted view)
//   - the role is shadowed on THIS request's user object only: the stored document is never changed (a `.save()` cannot write it)
const Case = require("../models/Case");

const SWITCHABLE = new Set(["employee", "beneficiary"]);
const OWN_FIELDS = ["user", "petitionerUser", "employerUser", "delegateEmployerUser"];
const idOf = (value) => (value && value._id ? String(value._id) : value ? String(value) : "");

/** Pure: is this person acting on their own case (client side), not on a case where they are the employee / beneficiary? */
function ownsAsClient(caseRow, userId) {
  if (!caseRow || caseRow.status === "removed") return false;
  const id = String(userId);
  if (idOf(caseRow.employeeUser) === id || idOf(caseRow.beneficiaryUser) === id) return false;
  return OWN_FIELDS.some((field) => idOf(caseRow[field]) === id);
}

/** Shadows role / principalCaseId on this request's user object only (the stored document and its saved data are untouched). */
function actAsClient(user, caseId) {
  const shadow = (key, value) => Object.defineProperty(user, key, { value, configurable: true, enumerable: true, writable: true });
  shadow("role", "client");
  shadow("principalCaseId", undefined);
  shadow("actingOnOwnCase", String(caseId));
}

async function applyActiveCaseRole(req, user, { CaseModel = Case } = {}) {
  try {
    if (!user || !SWITCHABLE.has(String(user.role || "").toLowerCase())) return false;
    const header = String(req.headers?.["x-active-case"] || "").trim();
    if (!/^[a-f0-9]{24}$/i.test(header)) return false;
    const caseRow = await CaseModel.findById(header).select(`status ${OWN_FIELDS.join(" ")} employeeUser beneficiaryUser`).lean();
    if (!ownsAsClient(caseRow, user._id)) return false;
    actAsClient(user, header);
    return true;
  } catch (error) {
    return false; // never block a request: the stored role applies
  }
}

module.exports = { applyActiveCaseRole, ownsAsClient, actAsClient };
