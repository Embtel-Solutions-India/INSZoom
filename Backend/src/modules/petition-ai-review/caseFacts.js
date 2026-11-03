// The case reference facts a petition is checked against (Petition AI Review): case number, visa type, and the names of the people and
// companies on the case. Read-only; loadCaseFacts() never throws - whatever cannot be read is simply left out (the prompt then tells the AI
// not to report mismatches it has no facts for).
const CASE_FIELDS = "caseNumber visaType visaCategory clientName petitionerName user employeeUser employerUser petitionerUser beneficiaryUser delegateEmployerUser companyId";
const PERSON_FIELDS = [
  ["beneficiaryUser", "Beneficiary"],
  ["petitionerUser", "Petitioner"],
  ["employeeUser", "Employee"],
  ["employerUser", "Employer contact"],
  ["delegateEmployerUser", "Delegate employer contact"],
  ["user", "Client"],
];

const idOf = (value) => (value?._id || value ? String(value?._id || value) : "");
const nameOf = (user) => String(user?.displayName || user?.name || "").trim();

/** Pure: facts from an already-loaded case, its users (id -> user) and company. */
function buildFacts({ caseDoc = {}, usersById = new Map(), company = null } = {}) {
  const people = [];
  const seen = new Set();
  const add = (role, name) => {
    const clean = String(name || "").trim();
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    people.push({ role, name: clean });
  };
  for (const [field, role] of PERSON_FIELDS) add(role, nameOf(usersById.get(idOf(caseDoc[field]))));
  add("Client", caseDoc.clientName);
  const companies = [];
  for (const name of [company?.legalName, company?.name, caseDoc.petitionerName]) {
    const clean = String(name || "").trim();
    if (clean && !companies.some((item) => item.name.toLowerCase() === clean.toLowerCase())) companies.push({ role: companies.length ? "Company (also)" : "Petitioner / employer company", name: clean });
  }
  return { caseNumber: String(caseDoc.caseNumber || "").trim(), visaType: String(caseDoc.visaType || caseDoc.visaCategory || "").trim(), people, companies };
}

/** Reads the case, its people and its company. deps (Case, User, Company models) are injectable for tests. */
async function loadCaseFacts(caseId, deps = {}) {
  try {
    const Case = deps.Case || require("../../models/Case");
    const User = deps.User || require("../../models/User");
    const caseDoc = await Case.findById(caseId).select(CASE_FIELDS).lean();
    if (!caseDoc) return buildFacts({});
    const ids = [...new Set(PERSON_FIELDS.map(([field]) => idOf(caseDoc[field])).filter(Boolean))];
    const [users, company] = await Promise.all([
      ids.length ? User.find({ _id: { $in: ids } }).select("name displayName").lean().catch(() => []) : [],
      caseDoc.companyId ? loadCompany(caseDoc.companyId, deps).catch(() => null) : null,
    ]);
    return buildFacts({ caseDoc, usersById: new Map((users || []).map((user) => [idOf(user._id), user])), company });
  } catch (_error) {
    return buildFacts({});
  }
}

async function loadCompany(companyId, deps) {
  const Company = deps.Company || require("../../models/Company");
  return Company.findById(companyId).select("name legalName").lean();
}

module.exports = { buildFacts, loadCaseFacts, CASE_FIELDS };
