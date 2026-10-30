// Cases are counted per person, not per matter: an employer matter that has employee child cases is only a container (its employees are
// the cases), so it is left out of case counts. A single applicant or a family case (petitioner + beneficiary live on one case) counts as 1.
// Used by every dashboard/analytics count; assignment queues deliberately do NOT use it (the principal is what gets assigned).
const COUNTABLE_CASE = {
  $nor: [
    { caseRole: "principal", caseStructure: "employer_employee" },
    { caseRole: "principal", "childCases.0": { $exists: true } },
  ],
};

/** Adds the countable-case condition to a Case filter without clobbering an existing $and. */
function withCountable(filter = {}) {
  return { ...filter, $and: [...(filter.$and || []), COUNTABLE_CASE] };
}

module.exports = { COUNTABLE_CASE, withCountable };
