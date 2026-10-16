// "Who did this", in the words the case team recognises: the person's own name, their registered email, and exactly which party they
// are on this case (Employer, Employee, Petitioner, Beneficiary, Delegate employer, Client) - used in the team emails instead of a bare
// case number.
const idOf = (value) => String(value?._id || value || "");
const sameId = (left, right) => Boolean(left && right && idOf(left) === idOf(right));

const ROLE_LABEL = { employer: "Employer", employee: "Employee", petitioner: "Petitioner", beneficiary: "Beneficiary" };

function actorRole(caseData = {}, parentCase = null, user = {}) {
  if (sameId(caseData.delegateEmployerUser, user._id) || sameId(parentCase?.delegateEmployerUser, user._id)) return "Delegate employer";
  // the party this account is on the case
  if (sameId(caseData.beneficiaryUser, user._id)) return "Beneficiary";
  if (sameId(caseData.petitionerUser, user._id)) return "Petitioner";
  if (sameId(caseData.employeeUser, user._id)) return "Employee";
  if (sameId(caseData.employerUser, user._id)) return "Employer";
  const role = String(user.role || "").toLowerCase();
  if (ROLE_LABEL[role]) return ROLE_LABEL[role];
  if (caseData.caseRole === "employee") return parentCase && sameId(parentCase.user, user._id) ? "Employer (filling in for the employee)" : "Employee";
  if (caseData.caseStructure === "employer_employee") return "Employer";
  return "Client";
}

// { name, email, role }
function actorInfo(user = {}, caseData = {}, parentCase = null) {
  return {
    name: user.displayName || user.name || user.email || "A client",
    email: user.email || "",
    role: actorRole(caseData, parentCase, user),
  };
}

module.exports = { actorInfo, actorRole };
