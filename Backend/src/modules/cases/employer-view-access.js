// READ-ONLY access of an employer to the file of an employee they have INVITED.
//
// Inviting an employee hands the child Case to the employee's own account (Case.user = employee, the employer's caseIds entry is pulled),
// so canAccessCase() - correctly - denies the employer: they must never be able to WRITE to it. What the employer may do is SEE what the
// employee has filled in and what is still missing (the "Read only view" on the employer's Employees dashboard), including the employee's
// uploaded documents. This module is that one narrow door:
//   * only the employer side (principal owner or delegate employer - delegate-employer.service isEmployerSide) of THAT employee's own
//     principal case, never another employer, never an employee, never a different principal's children
//   * only for a child (employee/beneficiary) case whose parentCase is that principal, and only while the file is actually held by the
//     employee (while the employer holds it, canAccessCase already lets them in and they can edit)
//   * only used by READ paths (the questionnaire/answers read, the checklist progress list and the stored-file download); every write
//     path keeps calling canAccessCase alone, so an invited employee's data can never be edited by the employer from here.
// Pure decision (`decide`) + one lookup of the parent case (only ever reached when canAccessCase already said no).
const delegateEmployerService = require("./delegate-employer.service");

const CHILD_ROLES = new Set(["employee", "beneficiary"]);
const sameId = (left, right) => Boolean(left && right) && String(left._id || left) === String(right._id || right);

/** Pure: may `user` read `childCase` as the employer of its principal `principal`? */
function decide(user, childCase, principal) {
  if (!user || !childCase || !principal) return false;
  if (!CHILD_ROLES.has(String(childCase.caseRole || ""))) return false;
  if (!sameId(childCase.parentCase, principal._id)) return false;
  if (!delegateEmployerService.isEmployerSide(principal, user)) return false;
  // held by the employee (an invitation is out); a file the employer holds is reached through the normal owner path
  if (!childCase.user || sameId(childCase.user, principal.user)) return false;
  return true;
}

/** May `user` read this child case's answers/progress/files as the employer of the principal case? (one indexed lookup, read paths only) */
async function canReadInvitedEmployeeCase(user, childCase) {
  if (!user || !childCase?.parentCase || !CHILD_ROLES.has(String(childCase.caseRole || ""))) return false;
  const Case = require("../../models/Case");
  const principal = await Case.findById(childCase.parentCase).select("user delegateEmployerUser").lean();
  return decide(user, childCase, principal);
}

module.exports = { decide, canReadInvitedEmployeeCase };
