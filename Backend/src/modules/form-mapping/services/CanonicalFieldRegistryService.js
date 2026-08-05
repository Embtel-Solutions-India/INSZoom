const BASE_FIELDS = [
  { path: "person.firstName", aliases: ["first name", "given name", "applicant first", "beneficiary first"], type: "text" },
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
  { path: "person.alienNumber", aliases: ["alien number", "a number", "uscis number"], type: "text" },
  { path: "person.ssn", aliases: ["ssn", "social security"], type: "text" },
  { path: "person.passport.number", aliases: ["passport number", "passport no"], type: "text" },
  { path: "person.passport.country", aliases: ["passport country", "country of issuance"], type: "text" },
  { path: "person.passport.issueDate", aliases: ["passport issue date", "date issued"], type: "date" },
  { path: "person.passport.expirationDate", aliases: ["passport expiration", "passport expiry", "expiry date"], type: "date" },
  { path: "contact.email", aliases: ["email", "email address"], type: "email" },
  { path: "contact.phone", aliases: ["phone", "telephone", "mobile"], type: "phone" },
  { path: "contact.address.line1", aliases: ["street address", "address line 1", "physical address"], type: "text" },
  { path: "contact.address.line2", aliases: ["address line 2", "apt", "suite"], type: "text" },
  { path: "contact.address.city", aliases: ["city", "town"], type: "text" },
  { path: "contact.address.state", aliases: ["state", "province"], type: "text" },
  { path: "contact.address.zip", aliases: ["zip", "postal code"], type: "text" },
  { path: "contact.address.country", aliases: ["country", "address country"], type: "text" },
  { path: "case.caseNumber", aliases: ["case number", "case id"], type: "text" },
  { path: "case.caseType", aliases: ["case type", "petition type"], type: "text" },
  { path: "case.visaType", aliases: ["visa type", "classification", "visa category"], type: "text" },
  { path: "case.priorityDate", aliases: ["priority date"], type: "date" },
  { path: "company.name", aliases: ["company name", "petitioner name", "employer name", "organization name"], type: "text" },
  { path: "company.legalName", aliases: ["legal business name", "legal company name"], type: "text" },
  { path: "company.ein", aliases: ["ein", "tax id", "federal employer identification"], type: "text" },
  { path: "company.phone", aliases: ["company phone", "employer phone", "petitioner phone"], type: "phone" },
  { path: "company.email", aliases: ["company email", "employer email", "petitioner email"], type: "email" },
  { path: "company.address.line1", aliases: ["company street", "employer street", "petitioner street"], type: "text" },
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
  { path: "immigration.i94.number", aliases: ["i-94", "i94 number", "arrival departure"], type: "text" },
  { path: "immigration.sevisNumber", aliases: ["sevis", "sevis number"], type: "text" },
  { path: "immigration.receiptNumbers[]", aliases: ["receipt number", "uscis receipt"], type: "text", repeatable: "receiptNumbers" },
  { path: "travelHistory[].arrivalDate", aliases: ["arrival date", "entry date"], type: "date", repeatable: "travelHistory" },
  { path: "travelHistory[].departureDate", aliases: ["departure date", "exit date"], type: "date", repeatable: "travelHistory" },
  { path: "documents[].type", aliases: ["document type", "evidence type"], type: "text", repeatable: "documents" },
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
