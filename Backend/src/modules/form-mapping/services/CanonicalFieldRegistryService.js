// person.*/contact.* = whoever's filing/signing this instance of the form
// (the applicant on a self-filed form, or - for a petition-type form -
// still resolved as the filer's own identity elsewhere in the mapping
// pipeline). beneficiary.* (added below, alongside person.*/contact.*) is
// a SEPARATE, real top-level namespace in the actual canonical profile
// (CanonicalDataService.build's output already has a distinct
// `beneficiary` object, confirmed live against a real case) for the
// person being petitioned FOR - every beneficiary.* path added here was
// checked against Beneficiary.js's real schema field-by-field, not
// guessed.
const BASE_FIELDS = [
  { path: "person.firstName", aliases: ["first name", "given name", "applicant first", "beneficiary first", "petitioner first"], type: "text" },
  { path: "person.middleName", aliases: ["middle name", "middle initial"], type: "text" },
  { path: "person.lastName", aliases: ["last name", "family name", "surname"], type: "text" },
  {
    path: "person.fullName",
    aliases: ["full name", "legal name", "complete name"],
    type: "text",
    derived: "fullName",
    components: ["person.firstName", "person.middleName", "person.lastName"],
  },
  { path: "person.dob", aliases: ["date of birth", "birth date", "dob"], type: "date" },
  { path: "person.gender", aliases: ["gender", "sex"], type: "boolean" },
  { path: "person.maritalStatus", aliases: ["marital status", "married", "single"], type: "text" },
  { path: "person.citizenship", aliases: ["citizenship", "country of citizenship", "nationality"], type: "text" },
  { path: "person.countryOfBirth", aliases: ["country of birth", "birth country"], type: "text" },
  // cityTownOfBirth/uscisOnlineAccountNumber/certificate* added for Phase 2
  // (I-130 petitioner canonical mapping) - I-130 Part 2 asks for these as
  // fields distinct from countryOfBirth/alienNumber, and no existing
  // person.* field represented them.
  { path: "person.cityTownOfBirth", aliases: ["city or town of birth", "city/town of birth"], type: "text" },
  { path: "person.uscisOnlineAccountNumber", aliases: ["uscis online account number"], type: "text" },
  { path: "person.certificateNumber", aliases: ["certificate number", "naturalization certificate number", "citizenship certificate number"], type: "text" },
  { path: "person.certificateDateOfIssuance", aliases: ["certificate date of issuance"], type: "date" },
  { path: "person.certificatePlaceOfIssuance", aliases: ["certificate place of issuance"], type: "text" },
  { path: "person.alienNumber", aliases: ["alien number", "a number", "uscis number", "alien registration number"], type: "text" },
  { path: "person.ssn", aliases: ["ssn", "social security"], type: "text" },
  { path: "person.passport.number", aliases: ["passport number", "passport no"], type: "text" },
  { path: "person.passport.country", aliases: ["passport country", "country of issuance"], type: "text" },
  { path: "person.passport.issueDate", aliases: ["passport issue date", "date issued"], type: "date" },
  { path: "person.passport.expirationDate", aliases: ["passport expiration", "passport expiry", "expiry date"], type: "date" },
  { path: "contact.email", aliases: ["email", "email address"], type: "email" },
  { path: "contact.phone", aliases: ["phone", "telephone", "daytime phone"], type: "phone" },
  { path: "contact.mobilePhone", aliases: ["mobile phone", "mobile number", "cell phone"], type: "phone" },
  { path: "contact.address.line1", aliases: ["street address", "address line 1", "physical address", "street number and name"], type: "text" },
  { path: "contact.address.line2", aliases: ["address line 2", "apt", "suite", "floor", "apartment suite or floor number"], type: "text" },
  { path: "contact.address.city", aliases: ["city", "town", "city or town"], type: "text" },
  { path: "contact.address.state", aliases: ["state", "select state from list of states"], type: "text" },
  { path: "contact.address.province", aliases: ["province"], type: "text" },
  { path: "contact.address.zip", aliases: ["zip", "postal code", "zip code"], type: "text" },
  { path: "contact.address.country", aliases: ["country", "address country"], type: "text" },
  { path: "case.caseNumber", aliases: ["case number", "case id"], type: "text" },
  { path: "case.caseType", aliases: ["case type", "petition type"], type: "text" },
  { path: "case.visaType", aliases: ["visa type", "classification", "visa category"], type: "text" },
  { path: "case.priorityDate", aliases: ["priority date"], type: "date" },
  { path: "case.receiptNumber", aliases: ["receipt number", "uscis receipt number"], type: "text" },
  { path: "company.name", aliases: ["company name", "petitioner name", "employer name", "organization name"], type: "text" },
  { path: "company.legalName", aliases: ["legal business name", "legal company name"], type: "text" },
  { path: "company.ein", aliases: ["ein", "tax id", "federal employer identification", "irs tax number"], type: "text" },
  { path: "company.phone", aliases: ["company phone", "employer phone", "petitioner phone"], type: "phone" },
  { path: "company.email", aliases: ["company email", "employer email", "petitioner email"], type: "email" },
  { path: "company.address.line1", aliases: ["company street", "employer street", "petitioner street"], type: "text" },
  { path: "company.address.line2", aliases: ["company suite", "employer suite", "petitioner suite or floor"], type: "text" },
  { path: "company.address.city", aliases: ["company city", "employer city", "petitioner city"], type: "text" },
  { path: "company.address.state", aliases: ["company state", "employer state", "petitioner state"], type: "text" },
  { path: "company.address.zip", aliases: ["company zip", "employer zip", "petitioner zip"], type: "text" },
  { path: "employment[].employerName", aliases: ["employer name", "employment employer", "current employer"], type: "text", repeatable: "employment" },
  { path: "employment[].jobTitle", aliases: ["job title", "position", "occupation"], type: "text", repeatable: "employment" },
  { path: "employment[].startDate", aliases: ["employment start", "start date"], type: "date", repeatable: "employment" },
  { path: "employment[].endDate", aliases: ["employment end", "end date"], type: "date", repeatable: "employment" },
  { path: "education[].institution", aliases: ["school", "institution", "university", "college"], type: "text", repeatable: "education" },
  { path: "education[].degree", aliases: ["degree", "qualification"], type: "text", repeatable: "education" },
  { path: "education[].fieldOfStudy", aliases: ["field of study", "major"], type: "text", repeatable: "education" },
  { path: "education[].graduationDate", aliases: ["graduation date", "completion date"], type: "date", repeatable: "education" },
  { path: "family.spouse.firstName", aliases: ["spouse first", "spouse given"], type: "text", condition: { field: "person.maritalStatus", operator: "in", value: ["married", "Married"] } },
  { path: "family.spouse.lastName", aliases: ["spouse last", "spouse family"], type: "text", condition: { field: "person.maritalStatus", operator: "in", value: ["married", "Married"] } },
  { path: "family.children[].firstName", aliases: ["child first", "dependent first"], type: "text", repeatable: "children" },
  { path: "family.children[].lastName", aliases: ["child last", "dependent last"], type: "text", repeatable: "children" },
  { path: "immigration.currentStatus", aliases: ["current status", "immigration status"], type: "text" },
  { path: "immigration.currentStatusExpirationDate", aliases: ["current status expiration", "status expiration date", "date status expires"], type: "date" },
  { path: "immigration.i94.number", aliases: ["i-94", "i94 number", "arrival departure"], type: "text" },
  { path: "immigration.sevisNumber", aliases: ["sevis", "sevis number"], type: "text" },
  { path: "immigration.receiptNumbers[]", aliases: ["receipt number", "uscis receipt"], type: "text", repeatable: "receiptNumbers" },
  { path: "travelHistory[].arrivalDate", aliases: ["arrival date", "entry date"], type: "date", repeatable: "travelHistory" },
  { path: "travelHistory[].departureDate", aliases: ["departure date", "exit date"], type: "date", repeatable: "travelHistory" },
  { path: "documents[].type", aliases: ["document type", "evidence type"], type: "text", repeatable: "documents" },

  // beneficiary.* - the person being petitioned FOR, distinct from the
  // filer/petitioner (person.* above). Mirrors Beneficiary.js's REAL,
  // verified schema field-for-field (confirmed against the model directly,
  // not guessed) - e.g. address fields are flat top-level strings on that
  // model (address/apartment/city/state/zipCode/country), never nested
  // under an "address" object the way contact.address.* is, and there is
  // no plain ssn field, only ssnLast4/ssnEncrypted (a full 9-digit SSN
  // field on a PDF is deliberately left unmapped rather than filling it
  // with a masked/encrypted partial value). Most USCIS petition forms
  // (I-129, I-130, I-140, I-360, I-526/-E, I-918, ...) need BOTH this and
  // person.* on the same form (e.g. Part 1 petitioner vs Part 3
  // beneficiary), which is exactly why so many address/name fields were
  // scoring too low to match anything before this addition - there was
  // only ever one generic person/contact/address concept for the scorer
  // to offer, so it could never tell a petitioner field from a
  // beneficiary field apart.
  { path: "beneficiary.firstName", aliases: ["beneficiary first name", "beneficiary given name"], type: "text" },
  { path: "beneficiary.middleName", aliases: ["beneficiary middle name"], type: "text" },
  { path: "beneficiary.lastName", aliases: ["beneficiary last name", "beneficiary family name"], type: "text" },
  { path: "beneficiary.fullName", aliases: ["beneficiary full name", "beneficiary legal name"], type: "text" },
  { path: "beneficiary.dateOfBirth", aliases: ["beneficiary date of birth"], type: "date" },
  { path: "beneficiary.gender", aliases: ["beneficiary gender", "beneficiary sex"], type: "boolean" },
  { path: "beneficiary.maritalStatus", aliases: ["beneficiary marital status"], type: "text" },
  { path: "beneficiary.countryOfCitizenship", aliases: ["beneficiary citizenship", "beneficiary country of citizenship"], type: "text" },
  { path: "beneficiary.countryOfBirth", aliases: ["beneficiary country of birth"], type: "text" },
  { path: "beneficiary.cityTownOfBirth", aliases: ["beneficiary city or town of birth"], type: "text" },
  { path: "beneficiary.nationality", aliases: ["beneficiary nationality"], type: "text" },
  { path: "beneficiary.alienRegistrationNumber", aliases: ["beneficiary alien number", "beneficiary a number", "beneficiary alien registration number"], type: "text" },
  { path: "beneficiary.email", aliases: ["beneficiary email"], type: "email" },
  { path: "beneficiary.primaryPhone", aliases: ["beneficiary phone", "beneficiary daytime phone"], type: "phone" },
  { path: "beneficiary.currentVisaStatus", aliases: ["beneficiary current status", "beneficiary class of admission", "beneficiary current nonimmigrant status"], type: "text" },
  { path: "beneficiary.sevisId", aliases: ["beneficiary sevis id", "beneficiary sevis number"], type: "text" },
  { path: "beneficiary.i94Number", aliases: ["beneficiary i-94", "beneficiary i94 number"], type: "text" },
  { path: "beneficiary.i94ExpirationDate", aliases: ["beneficiary i-94 expiration"], type: "date" },
  { path: "beneficiary.address", aliases: ["beneficiary street address", "beneficiary mailing address"], type: "text" },
  { path: "beneficiary.apartment", aliases: ["beneficiary apt suite or floor"], type: "text" },
  { path: "beneficiary.city", aliases: ["beneficiary city"], type: "text" },
  { path: "beneficiary.state", aliases: ["beneficiary state"], type: "text" },
  { path: "beneficiary.zipCode", aliases: ["beneficiary zip code"], type: "text" },
  { path: "beneficiary.country", aliases: ["beneficiary country"], type: "text" },
  { path: "beneficiary.passport.number", aliases: ["beneficiary passport number"], type: "text" },
  { path: "beneficiary.passport.country", aliases: ["beneficiary passport country"], type: "text" },
  { path: "beneficiary.passport.expirationDate", aliases: ["beneficiary passport expiration"], type: "date" },
];

class CanonicalFieldRegistryService {
  static tokenize(value = "") {
    return String(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => token && !["pt", "part", "line", "page", "item", "number", "no"].includes(token));
  }

  static flattenObject(source, prefix = "") {
    if (!source || typeof source !== "object") return [];
    if (Array.isArray(source)) {
      const sample = source.find((item) => item && typeof item === "object");
      return sample ? this.flattenObject(sample, `${prefix}[]`) : [{ path: `${prefix}[]`, type: "array" }];
    }
    return Object.entries(source).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object") return this.flattenObject(value, path);
      return [{ path, type: this.inferType(path, value) }];
    });
  }

  static inferType(path = "", value) {
    const normalized = path.toLowerCase();
    if (normalized.includes("date") || normalized.includes("dob") || value instanceof Date) return "date";
    if (normalized.includes("email")) return "email";
    if (normalized.includes("phone")) return "phone";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    return "text";
  }

  static list(canonicalProfile = {}) {
    const discovered = this.flattenObject(canonicalProfile).filter((field) => field.path && !field.path.includes("__"));
    const registry = new Map();
    [...BASE_FIELDS, ...discovered].forEach((field) => {
      if (!registry.has(field.path)) registry.set(field.path, { aliases: [], ...field });
    });
    return [...registry.values()].map((field) => ({
      ...field,
      id: `canonical:${field.path}`,
      label: field.label || field.path.split(".").pop().replace(/\[\]/g, ""),
      tokens: this.tokenize([field.path, ...(field.aliases || [])].join(" ")),
    }));
  }
}

module.exports = CanonicalFieldRegistryService;
