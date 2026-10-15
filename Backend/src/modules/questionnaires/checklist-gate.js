// Checklist approval gate - pure helpers (no DB, no service requires).
//
// A NEW case starts with every auto-assigned checklist as a DRAFT: staff see it on the case's Documents tab
// (and may edit it for this case, then approve it); the client portal does not see it, is not notified about
// it, and cannot answer it, until a case manager approves it. Existing cases (no Case.checklistApproval.required)
// are grandfathered - everything on them counts as approved.
//
// Approval is per checklist, per case. A checklist is identified by its BASE template key + target role, so a
// per-case copy (key "<template>__case_<caseId>", see case-checklist.service.js) is the same checklist as its
// template for approval purposes.

const CASE_COPY_SEPARATOR = "__case_";

const STAFF_ROLES = new Set([
  "super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal", "finance", "finance_team", "hr", "reviewer",
]);

const baseKey = (key) => String(key || "").split(CASE_COPY_SEPARATOR)[0];

const isCaseCopyKey = (key) => String(key || "").includes(CASE_COPY_SEPARATOR);

const caseCopyKey = (templateKey, caseId) => `${baseKey(templateKey)}${CASE_COPY_SEPARATOR}${caseId}`;

// Everyone who is not internal staff is on the client side of the gate (client, employer, employee, beneficiary, ...).
const isClientSideUser = (user) => !STAFF_ROLES.has(String(user?.role || "").toLowerCase().replace(/[\s-]+/g, "_"));

const isGated = (caseData) => Boolean(caseData?.checklistApproval?.required);

const checklistId = ({ key, targetRole }) => `${baseKey(key)}|${targetRole || ""}`;

const approvalFor = (caseData, entry) => (caseData?.checklistApproval?.approvals || []).find((approval) => approval.checklistId === checklistId(entry)) || null;

const isRemoved = (caseData, entry) => (caseData?.checklistApproval?.removed || []).some((item) => item.checklistId === checklistId(entry));

// Staff-requested checklists (Additional Requested Information, the Premium Processing add-on) were explicitly
// added by a case manager - they are not part of the automatic assignment and are never gated.
// ...with one exception: a staff-requested checklist can be HELD for approval (Case.checklistApproval.heldStaffChecklists, e.g. the
// Premium Processing / Form I-907 checklist right after a case manager upgrades a case). Until a case manager releases it the client
// side does not see it, is not notified and cannot answer it. A case with nothing held behaves exactly as before.
const isHeld = (caseData, entry) => (caseData?.checklistApproval?.heldStaffChecklists || []).includes(checklistId(entry));

// True when the client-side gate has anything to check on this case: a gated case, or one with a held staff checklist.
const needsGate = (caseData) => isGated(caseData) || (caseData?.checklistApproval?.heldStaffChecklists || []).length > 0;

function isApproved(caseData, entry) {
  if (entry?.staffRequest) return !isHeld(caseData, entry);
  if (!isGated(caseData)) return true;
  return Boolean(approvalFor(caseData, entry));
}

module.exports = {
  CASE_COPY_SEPARATOR, baseKey, isCaseCopyKey, caseCopyKey, isClientSideUser, isGated, needsGate, isHeld, checklistId, approvalFor, isApproved, isRemoved,
};
