// Plain-language wording for the golden set (the answer key a person reviews). Pure. A reviewer must never see a technical path such as
// "petitioner.signatory.firstName" or a field id such as "part1.form10Subform0Part1Line3GivenName0": every value is turned into a sentence an immigration
// professional reads naturally ("the employer's contact person - first (given) name").

// Who a data item is about, per case family. The words matter: "petitioner" means the EMPLOYER on an employment form and the SPONSOR on a family form.
const PARTY_WORDS = {
  employment: { petitioner: { who: "the employer", short: "Employer (petitioner)" }, beneficiary: { who: "the worker", short: "Worker (beneficiary)" }, applicant: { who: "the applicant", short: "Applicant" } },
  family: { petitioner: { who: "the sponsor", short: "Sponsor (petitioner)" }, beneficiary: { who: "the relative", short: "Relative (beneficiary)" }, applicant: { who: "the applicant", short: "Applicant" } },
  single: { petitioner: { who: "the petitioner", short: "Petitioner" }, beneficiary: { who: "the applicant", short: "Applicant" }, applicant: { who: "the applicant", short: "Applicant" } },
  general: { petitioner: { who: "the petitioner", short: "Petitioner" }, beneficiary: { who: "the client", short: "Beneficiary / client" }, applicant: { who: "the client", short: "Applicant / client" } },
};

const ROOT_PARTY = { petitioner: "petitioner", company: "petitioner", employer: "petitioner", beneficiary: "beneficiary", employee: "beneficiary", person: "applicant", contact: "applicant", immigration: "applicant" };

// words for the last parts of a path
const WORDS = {
  firstName: "first (given) name", lastName: "last (family) name", middleName: "middle name", fullName: "full name", name: "name", legalName: "legal name",
  dob: "date of birth", dateOfBirth: "date of birth", gender: "sex", maritalStatus: "marital status", citizenship: "country of citizenship", nationality: "nationality",
  countryOfBirth: "country of birth", cityTownOfBirth: "city / town of birth", provinceOfBirth: "province of birth", alienNumber: "A-Number", alienRegistrationNumber: "A-Number",
  ssn: "Social Security number", uscisOnlineAccountNumber: "USCIS online account number", email: "email address", phone: "daytime phone number", mobilePhone: "mobile phone number",
  primaryPhone: "phone number", ein: "employer ID number (EIN)", website: "website", title: "job title", jobTitle: "job title", positionTitle: "job title", salary: "salary", salaryUnit: "pay period",
  line1: "street number and name", line2: "apartment / suite / floor", city: "city or town", state: "state", zip: "ZIP code", zipCode: "ZIP code", postalCode: "ZIP / postal code",
  province: "province", country: "country", address: "address", street: "street number and name", apartment: "apartment / suite / floor", number: "number", expirationDate: "expiration date",
  issueDate: "issue date", passport: "passport", i94: "I-94", currentStatus: "current immigration status", visaType: "visa type", classification: "classification", priorityDate: "priority date",
  receiptNumber: "receipt number", caseNumber: "case number", businessType: "type of business", yearEstablished: "year established", numberOfEmployees: "number of employees",
  grossAnnualIncome: "gross annual income", netAnnualIncome: "net annual income", sevisId: "SEVIS number", lastArrivalDate: "date of last arrival", signatory: "authorized signatory",
  usMailingAddress: "U.S. mailing address", usPhysicalAddress: "U.S. physical address", mailingAddress: "mailing address", physicalAddress: "physical address", foreignAddress: "foreign address",
};

const splitWords = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b(\w+?)(\d+)\b/g, "$1 $2").toLowerCase().trim();
const wordsFor = (segment) => WORDS[segment] || splitWords(segment);

/** Reduces a raw questionnaire answer key to words: raw.questionnaireAnswers.i907_filer_first_name.value -> "filer first name". */
function questionnaireKeyWords(path) {
  const key = String(path).replace(/^raw\.questionnaireAnswers\./, "").split(".").filter((segment) => segment !== "value" && !/^\d+$/.test(segment)).join(" ");
  return splitWords(key.replace(/^[a-z]\d+[a-z]?_/i, ""));
}

/** Short party label for a path ("Employer (petitioner)", "Worker (beneficiary)", "Applicant", "The case", "Questionnaire answer"). */
function partyOfPath(path, family = "general") {
  const p = String(path || "");
  if (/^raw\./.test(p)) return "Client's questionnaire answer";
  const root = p.split(".")[0];
  if (root === "case") return "The case";
  if (root === "employment") return "The job offer";
  const party = ROOT_PARTY[root];
  return party ? (PARTY_WORDS[family] || PARTY_WORDS.general)[party].short : "Case data";
}

/** "the employer's contact person - first (given) name" for a canonical path. */
function describePath(path, family = "general") {
  const p = String(path || "").trim();
  if (!p) return "nothing";
  if (/^raw\.questionnaireAnswers\./.test(p)) return `the client's answer to the question "${questionnaireKeyWords(p)}"`;
  const parts = p.replace(/\[\d*\]/g, "").split(".");
  const root = parts[0];
  const rest = parts.slice(1);
  if (root === "case") return `the case's ${rest.map(wordsFor).join(" - ") || "details"}`;
  if (root === "employment") return `the job offer's ${rest.map(wordsFor).join(" - ") || "details"}`;
  const party = ROOT_PARTY[root];
  const owner = party ? (PARTY_WORDS[family] || PARTY_WORDS.general)[party].who : "the client";
  // petitioner.signatory.* is the person who signs / is the contact for the petitioner
  const tail = rest.map((segment, index) => (segment === "signatory" && index === 0 ? "contact person" : wordsFor(segment)));
  if (rest[0] === "signatory") return `${owner}'s contact person - ${tail.slice(1).join(" - ") || "details"}`;
  if (rest[0] === "address" || /Address$/.test(rest[0] || "")) return `${owner}'s ${tail[0]} - ${tail.slice(1).join(" - ") || "full address"}`;
  return `${owner}'s ${tail.join(" - ") || "details"}`;
}

const CHECKBOX_VALUE_WORDS = { true: "Yes", false: "No" };

/** How the value is written into the box, in a few plain words ("" for a plain copy). */
function describeTransform(transform = {}, family = "general") {
  const t = transform && typeof transform === "object" ? transform : { type: transform };
  switch (t.type) {
    case "date": case "dateFormat": return "written as a date (month/day/year)";
    case "checkbox": case "boolean": {
      if (t.optionsMap) {
        const ticksOn = Object.entries(t.optionsMap).filter(([, ticked]) => ticked === true).map(([answer]) => CHECKBOX_VALUE_WORDS[answer] || answer);
        return ticksOn.length ? `ticked when the answer is ${[...new Set(ticksOn)].join(" / ")}` : "a tick box";
      }
      if (t.value !== undefined) return `ticked when the answer is "${CHECKBOX_VALUE_WORDS[String(t.value)] || t.value}"`;
      return "ticked when the answer is Yes";
    }
    case "phone": return "written as a phone number, (123) 456-7890";
    case "ssn": return "written as a Social Security number, 123-45-6789";
    case "alienNumber": return "written as an A-Number";
    case "usState": return "written as the two-letter state";
    case "nonUsProvince": return "written as the province (non-U.S. addresses)";
    case "country": return "written as the country name";
    case "digits": return "digits only";
    case "address": return "taken from the address";
    case "listItem": return "one item picked from a list";
    case "arrayItem": return "one entry of a repeated list (for example the 2nd work location)";
    case "constant": return `always the fixed text "${t.value ?? ""}"`;
    case "join": return "several parts joined into one line";
    case "concat": case "fullName": return "several name parts joined into one full name";
    case "uppercase": return "in capital letters";
    case "lowercase": return "in lowercase";
    case "string": return "written as plain text";
    case "uscisReceiptNumber": return "written as a USCIS receipt number";
    case "digitAt": return "one digit of the number (the box takes one digit)";
    case "age": return "calculated as an age in years";
    default: return "";
  }
}

// ["K-1","K1","k-1","k1"] are one answer written four ways: show the first of each spelling
const uniqueValues = (values) => {
  const seen = new Set();
  return values.map(String).filter((value) => { const key = value.toLowerCase().replace(/[^a-z0-9]/g, ""); if (seen.has(key)) return false; seen.add(key); return true; });
};

const OPERATOR_WORDS = { equals: "is", "==": "is", not_equals: "is not", "!=": "is not", in: "is one of", not_in: "is not one of", exists: "is given", hasValue: "is given", empty: "is empty", gt: "is more than", ">": "is more than", gte: "is at least", ">=": "is at least", lt: "is less than", "<": "is less than", lte: "is at most", "<=": "is at most", contains: "includes" };

/** "only when the visa type is one of K-1" for a mapping condition (empty string when there is none). */
function describeCondition(condition, family = "general") {
  if (!condition || typeof condition !== "object") return "";
  const join = (items, word) => items.map((item) => describeCondition(item, family)).filter(Boolean).join(` ${word} `);
  if (Array.isArray(condition.all)) return join(condition.all, "and");
  if (Array.isArray(condition.any)) return join(condition.any, "or");
  const field = String(condition.field || condition.source || condition.path || condition.questionKey || "").replace(/^canonicalData\./, "");
  if (!field) return "";
  const subject = /^filledData\./.test(field) ? "another box on the form" : /^raw\.questionnaireAnswers\./.test(field) ? `the answer to "${questionnaireKeyWords(field)}"` : describePath(field, family).replace(/^the /, "the ");
  const value = Array.isArray(condition.value) ? uniqueValues(condition.value).join(", ") : condition.value;
  const operator = OPERATOR_WORDS[condition.operator] || condition.operator || "is";
  return ["exists", "hasValue", "empty"].includes(condition.operator) ? `${subject} ${operator}` : `${subject} ${operator} ${value}`;
}

/** The printed label without the technical "Item 3: Enter ..." prefix: "Item 3: Enter Given Name (First Name)" -> "Given Name (First Name)". */
function cleanLabel(label) {
  return String(label || "").replace(/^\s*(item|line|part)\s*\d+[a-z]?\.?\d*\s*[:.\-)]\s*/i, "").replace(/^(enter|select|choose|check)\s+/i, "").replace(/\s+/g, " ").trim();
}

/** "Part 1, Item 3, page 2" from what the edge records. */
function whereOnForm({ section, targetLabel, pageNumber } = {}) {
  const item = /^\s*(?:item|line)\s*(\d+[a-z]?(?:\.\d+)?)/i.exec(String(targetLabel || ""));
  const part = /^part\s*\d+/i.test(String(section || "")) ? String(section).replace(/^part\s*/i, "Part ").trim() : "";
  const bits = [part, item ? `Item ${item[1]}` : "", pageNumber ? `page ${pageNumber}` : ""].filter(Boolean);
  return bits.join(", ") || "location not recorded";
}

/** Plain widget kind for a reviewer. */
function widgetKind(type) {
  const t = String(type || "text").toLowerCase();
  if (/check/.test(t)) return "checkbox";
  if (/radio/.test(t)) return "radio";
  if (/drop|select|combo|list/.test(t)) return "dropdown";
  if (/date/.test(t)) return "date";
  return "text";
}

module.exports = { PARTY_WORDS, describePath, describeTransform, describeCondition, cleanLabel, whereOnForm, partyOfPath, widgetKind, splitWords, questionnaireKeyWords };
