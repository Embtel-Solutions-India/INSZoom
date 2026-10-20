// Fills the two generic party roots every USCIS form is mapped against - beneficiary.* (the worker / applicant) and petitioner.* (the employer /
// sponsoring entity) - from the data the case already holds under person.* / contact.* / immigration.* / company.* and from free-text address
// answers. A form field then maps to ONE generic path no matter which questionnaire, profile or document produced the value, and every form that
// asks for the same fact (the petitioner name appears many times on an I-129) reads the same path.
//
// Rules: pure and idempotent; a value that is already present is NEVER overwritten; nothing is guessed (a free-text address is split by
// AddressParser, which leaves a part blank unless the text shows it).
const AddressParser = require("../../form-mapping/services/AddressParser");

const getPath = (source, path) => path.split(".").reduce((cursor, key) => (cursor === null || cursor === undefined ? undefined : cursor[key]), source);
const blank = (value) => value === undefined || value === null || value === "" || (typeof value === "string" && !value.trim());
function setPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[keys[keys.length - 1]] = value;
}

// [generic path, ...sources in priority order]
const BENEFICIARY_SOURCES = [
  ["beneficiary.firstName", "person.firstName"],
  ["beneficiary.middleName", "person.middleName"],
  ["beneficiary.lastName", "person.lastName"],
  ["beneficiary.dateOfBirth", "person.dob"],
  ["beneficiary.gender", "person.gender"],
  ["beneficiary.maritalStatus", "person.maritalStatus"],
  ["beneficiary.countryOfBirth", "person.countryOfBirth"],
  ["beneficiary.cityTownOfBirth", "person.cityTownOfBirth"],
  ["beneficiary.provinceOfBirth", "person.provinceOfBirth"],
  ["beneficiary.countryOfCitizenship", "person.citizenship"],
  ["beneficiary.nationality", "person.citizenship"],
  ["beneficiary.alienRegistrationNumber", "person.alienNumber"],
  ["beneficiary.ssn", "person.ssn"],
  ["beneficiary.uscisOnlineAccountNumber", "person.uscisOnlineAccountNumber"],
  ["beneficiary.email", "contact.email"],
  ["beneficiary.primaryPhone", "contact.phone", "contact.mobilePhone"],
  ["beneficiary.mobilePhone", "contact.mobilePhone"],
  ["beneficiary.address", "contact.address.line1"],
  ["beneficiary.apartment", "contact.address.line2"],
  ["beneficiary.city", "contact.address.city"],
  ["beneficiary.state", "contact.address.state"],
  ["beneficiary.zipCode", "contact.address.zip"],
  ["beneficiary.country", "contact.address.country"],
  ["beneficiary.passport.number", "person.passport.number"],
  ["beneficiary.passport.country", "person.passport.country"],
  ["beneficiary.passport.issueDate", "person.passport.issueDate"],
  ["beneficiary.passport.expirationDate", "person.passport.expirationDate"],
  ["beneficiary.currentVisaStatus", "immigration.currentStatus"],
  ["beneficiary.currentVisaExpirationDate", "immigration.currentStatusExpirationDate"],
  ["beneficiary.i94Number", "immigration.i94.number"],
  ["beneficiary.i94ExpirationDate", "immigration.i94.expirationDate"],
  ["beneficiary.sevisId", "immigration.sevisNumber"],
  ["beneficiary.lastArrivalDate", "immigration.lastArrivalDate"],
  ["beneficiary.foreignAddress.line1", "contact.foreignAddress.line1"],
  // an address answered as ONE line is kept whole (and split into parts below)
  ["beneficiary.currentAddress.formatted", "contact.address.formatted"],
  ["beneficiary.foreignAddress.formatted", "contact.foreignAddress.formatted"],
];

const PETITIONER_SOURCES = [
  ["petitioner.name", "company.name", "company.legalName"],
  ["petitioner.ein", "company.ein"],
  ["petitioner.phone", "company.phone", "company.contact.phone", "company.authorizedRepresentative.phone"],
  ["petitioner.email", "company.email", "company.contact.email"],
  ["petitioner.website", "company.website"],
  ["petitioner.businessType", "company.industry"],
  ["petitioner.yearEstablished", "company.yearEstablished"],
  ["petitioner.numberOfEmployees", "company.numberOfEmployees"],
  ["petitioner.grossAnnualIncome", "company.grossAnnualIncome"],
  ["petitioner.netAnnualIncome", "company.netAnnualIncome"],
  ["petitioner.address.line1", "company.address.line1"],
  ["petitioner.address.line2", "company.address.line2"],
  ["petitioner.address.city", "company.address.city"],
  ["petitioner.address.state", "company.address.state"],
  ["petitioner.address.zip", "company.address.zip"],
  ["petitioner.address.country", "company.address.country"],
  ["petitioner.signatory.firstName", "company.authorizedRepresentative.firstName", "company.contact.firstName"],
  ["petitioner.signatory.lastName", "company.authorizedRepresentative.lastName", "company.contact.lastName"],
  ["petitioner.signatory.title", "company.authorizedRepresentative.title", "company.contact.title"],
  ["petitioner.signatory.phone", "company.authorizedRepresentative.phone", "company.contact.phone"],
  ["petitioner.signatory.email", "company.authorizedRepresentative.email", "company.contact.email"],
  ["petitioner.jobTitle", "employment.jobTitle"],
  ["petitioner.wage", "employment.wage"],
  ["petitioner.address.formatted", "company.address.formatted"],
];

// one free-text address answer -> the structured parts (only the parts the text actually shows)
const ADDRESS_BLOCKS = [
  { text: ["contact.address.formatted", "contact.address.full"], target: "beneficiary", keys: { address: "street", apartment: "unitNumber", city: "city", state: "state", zipCode: "zip", country: "country" } },
  { text: ["company.address.formatted", "company.address.full"], target: "petitioner.address", keys: { line1: "street", line2: "unitNumber", city: "city", state: "state", zip: "zip", country: "country" } },
];

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

function fill(profile, rows) {
  for (const [target, ...sources] of rows) {
    if (!blank(getPath(profile, target))) continue;
    for (const source of sources) {
      const value = getPath(profile, source);
      if (!blank(value)) { setPath(profile, target, value); break; }
    }
  }
}

// A structured address answer arrives as {line1, line2, city, state, postalCode, country}; copy its parts to the flat generic fields (never overwriting)
function flattenStructuredAddresses(profile) {
  const copy = (source, target, map) => {
    const object = getPath(profile, source);
    if (!object || typeof object !== "object" || Array.isArray(object)) return;
    for (const [from, to] of Object.entries(map)) {
      const value = object[from];
      if (!blank(value) && blank(getPath(profile, `${target}.${to}`))) setPath(profile, `${target}.${to}`, value);
    }
  };
  copy("beneficiary.currentUSAddress", "beneficiary", { line1: "address", line2: "apartment", city: "city", state: "state", postalCode: "zipCode", country: "country" });
  copy("petitioner.company.address", "petitioner.address", { line1: "line1", line2: "line2", city: "city", state: "state", postalCode: "zip", country: "country" });
}

// I-129 Part 5 Item 3 asks for the address where the beneficiary will work "if different from Part 1": keep only the job locations whose street differs from the petitioner's own
function deriveOffSiteWorkLocations(profile) {
  const rows = getPath(profile, "employment.workLocations");
  if (!Array.isArray(rows) || !rows.length || Array.isArray(getPath(profile, "employment.offSiteWorkLocations"))) return;
  const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const own = norm(getPath(profile, "petitioner.address.line1"));
  const different = rows.filter((row) => row && typeof row === "object" && !blank(row.address) && (!own || norm(row.address) !== own));
  if (different.length) setPath(profile, "employment.offSiteWorkLocations", different);
}

// the "New status and effective date" answer is one record; expose its two parts on their own canonical paths
function deriveRequestedStatus(profile) {
  const row = (getPath(profile, "application.requestedStatusRecord") || [])[0];
  if (!row || typeof row !== "object") return;
  if (blank(getPath(profile, "application.requestedStatus")) && !blank(row.status)) setPath(profile, "application.requestedStatus", row.status);
  if (blank(getPath(profile, "application.requestedStatusEffectiveDate")) && !blank(row.effectiveDate)) setPath(profile, "application.requestedStatusEffectiveDate", row.effectiveDate);
}

// ---- generic -> legacy back-fill ------------------------------------------------------------------------------------------------------------------------
// Checklists now store answers under the generic petitioner.* / beneficiary.* paths. Everything else that still reads the older shared paths (person.*,
// contact.*, company.*, immigration.* - other forms' mappings, the employee / employer profiles, document rules) must keep receiving the same facts, so
// a blank legacy path is filled from its generic twin. The same tables as above, read the other way: FIRST listed source only; a legacy value that is
// already present is NEVER overwritten; running it again changes nothing.
function backfillLegacy(profile, rows) {
  for (const [generic, legacy] of rows) {
    if (!legacy || !blank(getPath(profile, legacy))) continue;
    const value = getPath(profile, generic);
    if (!blank(value) && typeof value !== "object") setPath(profile, legacy, value);
  }
}

// family case: person.* / contact.* ARE the petitioner (see canonical/config/familyPartyPaths.js); beneficiary.* is already the beneficiary's own
const PETITIONER_FAMILY_LEGACY = [
  ["petitioner.lastName", "person.lastName"],
  ["petitioner.firstName", "person.firstName"],
  ["petitioner.middleName", "person.middleName"],
  ["petitioner.dateOfBirth", "person.dob"],
  ["petitioner.gender", "person.gender"],
  ["petitioner.maritalStatus", "person.maritalStatus"],
  ["petitioner.ssn", "person.ssn"],
  ["petitioner.aNumber", "person.alienNumber"],
  ["petitioner.countryOfBirth", "person.countryOfBirth"],
  ["petitioner.countryOfCitizenship", "person.citizenship"],
  ["petitioner.citizenshipCertificateNumber", "person.certificateNumber"],
  ["petitioner.citizenshipCertificatePlaceOfIssuance", "person.certificatePlaceOfIssuance"],
  ["petitioner.citizenshipCertificateDateOfIssuance", "person.certificateDateOfIssuance"],
  ["petitioner.cityTownOfBirth", "person.cityTownOfBirth"],
  ["petitioner.uscisOnlineAccountNumber", "person.uscisOnlineAccountNumber"],
  ["petitioner.physicalAddress", "contact.address.line1"],
];

function apply(profile) {
  if (!profile || typeof profile !== "object") return profile;
  // person.* / company.* mean beneficiary / petitioner only in an employer-sponsored case; in a family case person.* is the petitioner, so nothing is derived there
  const structure = profile.case && profile.case.caseStructure;
  // a two-party case is a family case whether its structure says so or the builder found a petitioner account (profile.case.familyParties)
  const familyParties = structure === "family" || (profile.case && profile.case.familyParties === true);
  if (familyParties || (structure && structure !== "employer_employee" && structure !== "single")) {
    // family: the petitioner's checklist answers also fill the person.* / contact.* paths the family forms and the sponsor forms read
    if (familyParties) backfillLegacy(profile, PETITIONER_FAMILY_LEGACY);
    return profile;
  }
  flattenStructuredAddresses(profile);
  fill(profile, BENEFICIARY_SOURCES);
  fill(profile, PETITIONER_SOURCES);
  backfillLegacy(profile, BENEFICIARY_SOURCES.map(([generic, legacy]) => [generic, legacy]));
  backfillLegacy(profile, PETITIONER_SOURCES.map(([generic, legacy]) => [generic, legacy]));
  // the petitioner's authorized signatory may only be known as one full name
  const signatory = getPath(profile, "company.authorizedRepresentative.name") || getPath(profile, "company.contact.name");
  const split = splitName(signatory);
  if (split) {
    if (blank(getPath(profile, "petitioner.signatory.firstName")) && blank(getPath(profile, "company.authorizedRepresentative.firstName"))) setPath(profile, "petitioner.signatory.firstName", split.firstName);
    if (blank(getPath(profile, "petitioner.signatory.lastName")) && blank(getPath(profile, "company.authorizedRepresentative.lastName"))) setPath(profile, "petitioner.signatory.lastName", split.lastName);
  }
  for (const block of ADDRESS_BLOCKS) {
    const text = block.text.map((path) => getPath(profile, path)).find((value) => !blank(value));
    if (!text) continue;
    let parsedAny = false;
    for (const [key, part] of Object.entries(block.keys)) {
      const targetPath = `${block.target}.${key}`;
      if (!blank(getPath(profile, targetPath))) continue;
      const value = AddressParser.addressPart(text, part);
      if (!blank(value)) { setPath(profile, targetPath, value); parsedAny = true; }
    }
    // an address the splitter cannot break apart (one line such as "ccc block a") is still the street line - never guessed into city / state / ZIP
    const streetPath = `${block.target}.${Object.keys(block.keys)[0]}`;
    if (!parsedAny && blank(getPath(profile, streetPath))) setPath(profile, streetPath, String(text).trim());
  }
  deriveOffSiteWorkLocations(profile);
  deriveRequestedStatus(profile);
  return profile;
}

module.exports = { apply, BENEFICIARY_SOURCES, PETITIONER_SOURCES, PETITIONER_FAMILY_LEGACY };
