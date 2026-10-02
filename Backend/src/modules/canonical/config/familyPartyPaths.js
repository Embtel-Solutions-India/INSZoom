// Two-party (petitioner + beneficiary) cases - K-1/K-3 and the I-130 family
// categories - keep BOTH parties' data in ONE Case. The canonical profile's
// person.* / contact.* namespaces describe "the applicant" (one person), so
// without a rule, two people write into the same paths: a petitioner's name
// and the beneficiary's passport OCR both land on person.lastName, conflict,
// and CASE_LIFECYCLE generateForms refuses to run (CANONICAL_NEEDS_REVIEW) or
// - worse - the winner by priority puts the wrong person's name on the form.
//
// The rule (applied by CanonicalBuilderService for family cases only):
//   person.* / contact.*   = the PETITIONER  (what the I-130 mapping graph and
//                            canonicalPathFixes.seed.js's K-3/IR maps already
//                            mean by them, and the I-134 sponsor)
//   beneficiary.*          = the BENEFICIARY (as before)
// A candidate for a party-ambiguous path is routed by WHO it came from
// (answer.participantRole / extraction.participantRole): petitioner -> path as
// is, beneficiary -> its beneficiary.* counterpart below (or dropped when none
// exists), anyone/anything unattributed -> dropped. It is never written to the
// other party's namespace.
//
// Forms whose applicant is the beneficiary (I-485, I-765, I-131, I-693, DS-160,
// I-130A, G-325A) read a person-shaped PROJECTION of beneficiary.* instead -
// see projectFamilyProfile() and CanonicalBiographicAutofill.

// person.* / contact.* path -> the beneficiary.* path holding the same fact
// (beneficiary.* field names follow the Beneficiary model / the I-130 mapping).
const PERSON_TO_BENEFICIARY = {
  "person.firstName": "beneficiary.firstName",
  "person.middleName": "beneficiary.middleName",
  "person.lastName": "beneficiary.lastName",
  "person.fullName": "beneficiary.fullName",
  "person.dob": "beneficiary.dateOfBirth",
  "person.gender": "beneficiary.gender",
  "person.maritalStatus": "beneficiary.maritalStatus",
  "person.citizenship": "beneficiary.countryOfCitizenship",
  "person.countryOfBirth": "beneficiary.countryOfBirth",
  "person.cityTownOfBirth": "beneficiary.cityTownOfBirth",
  "person.alienNumber": "beneficiary.alienRegistrationNumber",
  "person.passport.number": "beneficiary.passport.number",
  "person.passport.country": "beneficiary.passport.country",
  "person.passport.issueDate": "beneficiary.passport.issueDate",
  "person.passport.expirationDate": "beneficiary.passport.expirationDate",
  "contact.email": "beneficiary.email",
  "contact.phone": "beneficiary.primaryPhone",
  "contact.address.line1": "beneficiary.address",
  "contact.address.line2": "beneficiary.apartment",
  "contact.address.city": "beneficiary.city",
  "contact.address.state": "beneficiary.state",
  "contact.address.zip": "beneficiary.zipCode",
  "contact.address.country": "beneficiary.country",
};

const PARTY_AMBIGUOUS_PATH = /^(person|contact)\./;

const PETITIONER_ONLY_FORMS = new Set(["I-129F", "I-130", "I-134", "I-864", "I-864EZ", "I-864A", "I-864W"]);

function isFamilyPartiesCase(caseRecord = {}) {
  return Boolean(caseRecord.petitionerUser) || caseRecord.caseStructure === "family";
}

// "petitioner" | "beneficiary" | null for a role string or a questionnaire/document type name.
function partyOf(...hints) {
  for (const hint of hints) {
    const text = String(hint || "").toLowerCase();
    if (!text) continue;
    if (text === "petitioner") return "petitioner";
    if (text === "beneficiary") return "beneficiary";
    if (/(^|[_\s-])petitioner([_\s-]|$)/.test(text)) return "petitioner";
    if (/(^|[_\s-])beneficiary([_\s-]|$)/.test(text)) return "beneficiary";
  }
  return null;
}

// Route a candidate's target path by the party it came from. Returns the path
// to write, or null when the candidate must be dropped.
function scopeFamilyPath(path, party) {
  if (!path || !PARTY_AMBIGUOUS_PATH.test(path)) return path;
  if (party === "petitioner") return path;
  if (party === "beneficiary") return PERSON_TO_BENEFICIARY[path] || null;
  return null;
}

function getByPath(source, path) {
  return String(path).split(".").reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), source);
}

function setByPath(target, path, value) {
  const segments = String(path).split(".");
  let cursor = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    if (cursor[segment] === undefined || cursor[segment] === null || typeof cursor[segment] !== "object") cursor[segment] = {};
    cursor = cursor[segment];
  });
}

// The party a form is ABOUT: the petitioner for the petition/sponsor forms,
// the beneficiary (the applicant) for every other family-visa form.
function subjectPartyForForm(formCode) {
  const code = String(formCode || "").toUpperCase().replace(/\s+/g, "");
  return PETITIONER_ONLY_FORMS.has(code) ? "petitioner" : "beneficiary";
}

// A person.* / contact.* shaped view of the chosen party, so generic
// person-based autofill (CanonicalBiographicAutofill) reads the right
// individual. Petitioner: the profile as built. Beneficiary: person.*/contact.*
// REBUILT from beneficiary.* - the petitioner's values are never carried over
// (a field the beneficiary has no value for stays blank).
function projectFamilyProfile(profile = {}, party = "petitioner") {
  if (party !== "beneficiary") return profile;
  const projected = { ...profile, person: {}, contact: {} };
  Object.entries(PERSON_TO_BENEFICIARY).forEach(([personPath, beneficiaryPath]) => {
    const value = getByPath(profile, beneficiaryPath);
    if (value !== undefined && value !== null && value !== "") setByPath(projected, personPath, value);
  });
  return projected;
}

module.exports = {
  PERSON_TO_BENEFICIARY, PARTY_AMBIGUOUS_PATH, PETITIONER_ONLY_FORMS,
  isFamilyPartiesCase, partyOf, scopeFamilyPath, subjectPartyForForm, projectFamilyProfile,
};
