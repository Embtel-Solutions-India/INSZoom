// Which checklist roles belong to the PRINCIPAL side of a principal/child
// case family and are therefore shared with every child case, rather than
// answered independently per child. Keyed by Case.caseStructure so this
// applies uniformly across every visa type/case that uses that structure
// (H-1B, L-1A, E-2, O-1, TN, ... any employer_employee case; any family
// case), never one specific case, form, or checklist.
const SHARED_PRINCIPAL_ROLES_BY_STRUCTURE = {
  employer_employee: new Set(["employer", "business_plan", "supporting_documents"]),
  family: new Set(["petitioner"]),
};

// True when targetRole is one of caseData's structure's "shared" roles AND
// caseData is itself a child case (has a parentCase) — i.e. the case being
// read/written is not where this role's real data lives; resolution should
// redirect to caseData.parentCase instead.
function isSharedRoleForChildCase(caseData, targetRole) {
  if (!targetRole || !caseData?.parentCase) return false;
  const roles = SHARED_PRINCIPAL_ROLES_BY_STRUCTURE[caseData.caseStructure];
  return Boolean(roles && roles.has(targetRole));
}

module.exports = { SHARED_PRINCIPAL_ROLES_BY_STRUCTURE, isSharedRoleForChildCase };
