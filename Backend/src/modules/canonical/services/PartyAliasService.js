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

function apply(profile) {
  if (!profile || typeof profile !== "object") return profile;
  // person.* / company.* mean beneficiary / petitioner only in an employer-sponsored case; in a family case person.* is the petitioner, so nothing is derived there
  const structure = profile.case && profile.case.caseStructure;
  if (structure && structure !== "employer_employee") return profile;
  fill(profile, BENEFICIARY_SOURCES);
  fill(profile, PETITIONER_SOURCES);
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
  return profile;
}

module.exports = { apply, BENEFICIARY_SOURCES, PETITIONER_SOURCES };
