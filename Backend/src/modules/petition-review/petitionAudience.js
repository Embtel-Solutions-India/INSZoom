// Who is the CLIENT-SIDE audience of a petition (owner decision):
//   single person case        -> that person
//   family case               -> the petitioner (never the beneficiary)
//   employer-employee case    -> the employer only (never the employee)
// Pure: takes the case (and, for a child case, its parent) as plain objects. Returns { role, userId } or null when the case has no such party yet.
const idOf = (value) => {
  const raw = value?._id || value;
  return raw ? String(raw) : "";
};
const first = (...candidates) => candidates.map(idOf).find(Boolean) || "";

function pickAudience(caseData = {}, parent = null) {
  const principal = parent || caseData;
  const structure = caseData.caseStructure || principal.caseStructure || null;
  // the owner of a principal (employer / petitioner) case is the person who holds that role
  const principalOwner = parent ? parent.user : caseData.caseRole === "principal" || !caseData.parentCase ? caseData.user : null;

  if (structure === "employer_employee") {
    const userId = first(caseData.employerUser, principal.employerUser, principalOwner);
    return userId ? { role: "employer", userId } : null;
  }
  if (structure === "family") {
    const userId = first(caseData.petitionerUser, principal.petitionerUser, principalOwner, caseData.user);
    return userId ? { role: "petitioner", userId } : null;
  }
  if (structure === "single") {
    const userId = first(caseData.user);
    return userId ? { role: "client", userId } : null;
  }
  // cases created before case structures existed: an employer / petitioner on the case wins, otherwise the one client
  const legacyEmployer = first(caseData.employerUser);
  if (legacyEmployer) return { role: "employer", userId: legacyEmployer };
  const legacyPetitioner = first(caseData.petitionerUser);
  if (legacyPetitioner) return { role: "petitioner", userId: legacyPetitioner };
  const userId = first(caseData.user);
  return userId ? { role: "client", userId } : null;
}

module.exports = { pickAudience, idOf };
