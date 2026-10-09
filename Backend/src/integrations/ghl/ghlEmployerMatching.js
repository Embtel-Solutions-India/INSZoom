const Case = require("../../models/Case");
const User = require("../../models/User");
const EmployerProfile = require("../../models/EmployerProfile");
const GHLEmployerLink = require("../../models/GHLEmployerLink");
const { normalizeRole } = require("../../modules/authorization/roleHierarchy");

// Decides which employer matter a new GHL opportunity belongs to.
//
// Email is only a matching SIGNAL, never the employer's identity (HR changes
// email, one company has several HR contacts, an agency mailbox can serve several
// employers). The order is:
//   1. an existing GHL link:  this GHL contact already belongs to an employer matter
//   2. exact normalised email, against the employer matters that account owns
//   3. otherwise: no employer yet -> a new matter will be created
// Anything uncertain is reported as "ambiguous" with a reason; the caller then
// attaches NOTHING and flags the opportunity for a team lead.

const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "pllc", "pc", "llp", "lp", "plc"]);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

function companyTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !LEGAL_SUFFIXES.has(token));
}

// Conservative: every word of the shorter name must be the start of the matching word
// of the longer one, in order. "ABC Tech LLC" ~ "ABC Technologies Inc", but
// "ABC Staffing" is NOT ~ "ABC Technologies". Wrongly saying "different" only
// costs a team-lead check; wrongly saying "same" would mix two companies.
function namesCompatible(a, b) {
  const ta = companyTokens(a);
  const tb = companyTokens(b);
  if (!ta.length || !tb.length) return true; // nothing to compare
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((token, index) => long[index].startsWith(token));
}

// The COMPANY names a matter is known by (case field, profile, questionnaire). The contact person's name is
// deliberately not a company name: the same HR person can write from a different company, and that is exactly the
// case to catch. Only when a matter has no company name at all do we fall back to its client name.
async function principalNames(principal) {
  const names = [principal.petitionerName, principal.questionnaireData?.masterData?.employer?.company?.fullName];
  try {
    const profile = await EmployerProfile.findOne({ principalCaseId: principal._id }).select("canonicalData.legalName").lean();
    names.push(profile?.canonicalData?.legalName?.value);
  } catch {
    /* names are best-effort */
  }
  const companies = names.filter((n) => typeof n === "string" && n.trim());
  if (companies.length) return companies;
  return [principal.clientName].filter((n) => typeof n === "string" && n.trim());
}

const isLiveEmployerMatter = (c) => c && c.caseStructure === "employer_employee" && c.caseRole === "principal" && c.status !== "removed" && c.status !== "archived";

/**
 * @returns { status: "linked" | "email_match" | "none" | "ambiguous", principal?, existingUser?, reason? }
 */
async function findEmployerMatch({ locationId, contactId, email, names = [] }) {
  // 1. A GHL contact we already know.
  if (contactId) {
    const link = await GHLEmployerLink.findOne({ locationId, contactId }).lean();
    if (link) {
      const principal = await Case.findById(link.principalCaseId);
      if (isLiveEmployerMatter(principal)) return { status: "linked", principal };
      // A dangling link (matter gone) is ignored; matching continues.
    }
  }

  // 2. Exact email.
  const normalized = normalizeEmail(email);
  if (!normalized) return { status: "none", reason: "no email on the GHL contact" };
  const user = await User.findOne({ email: normalized }).select("email role primaryCaseId caseIds");
  if (!user) return { status: "none" };
  if (normalizeRole(user.role) !== "client") {
    return { status: "ambiguous", reason: "this email belongs to a non-client account" };
  }

  const ownedIds = [...new Set([...(user.caseIds || []), user.primaryCaseId].filter(Boolean).map(String))];
  if (!ownedIds.length) return { status: "none", existingUser: user }; // a client account with no cases yet: a new matter can use it

  const owned = await Case.find({ _id: { $in: ownedIds } }).select("caseStructure caseRole status petitionerName clientName questionnaireData.masterData.employer.company.fullName");
  const matters = owned.filter(isLiveEmployerMatter);
  if (!matters.length) return { status: "ambiguous", reason: "this email belongs to a client who already has a non-employer case" };
  if (matters.length > 1) return { status: "ambiguous", reason: `this email owns ${matters.length} employer matters` };

  // The lookup above only selected the few fields needed to decide; callers need the whole employer matter
  // (case number, visa, assignment, children), so load it in full once the match is confirmed.
  const principal = await Case.findById(matters[0]._id);
  const known = await principalNames(principal);
  const wanted = names.filter(Boolean);
  if (known.length && wanted.length && !known.some((k) => wanted.some((w) => namesCompatible(k, w)))) {
    return { status: "ambiguous", reason: `same email but a different company name ("${wanted[0]}" vs "${known[0]}")` };
  }
  return { status: "email_match", principal };
}

module.exports = { findEmployerMatch, namesCompatible, companyTokens, normalizeEmail, isLiveEmployerMatter };
