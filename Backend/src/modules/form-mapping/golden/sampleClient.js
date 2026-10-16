// A FICTIONAL client used only to show a reviewer what a box would contain ("for our sample client Maria Gonzalez this box shows: Maria"). None of these values is
// real, and the Social Security / A-numbers are in ranges that can never be issued. Pure.
const MappingResolver = require("../services/MappingResolver");

const PEOPLE = {
  // the worker / relative / applicant
  beneficiary: { firstName: "Maria", middleName: "Elena", lastName: "Gonzalez", fullName: "Maria Elena Gonzalez" },
  // the employer / sponsor and their contact person
  petitioner: { firstName: "Daniel", middleName: "James", lastName: "Carter", fullName: "Daniel James Carter" },
};

const BY_TAIL = {
  dob: "1990-03-15", dateOfBirth: "1990-03-15", gender: "female", maritalStatus: "married", citizenship: "Mexico", nationality: "Mexico", countryOfBirth: "Mexico",
  cityTownOfBirth: "Guadalajara", provinceOfBirth: "Jalisco", alienNumber: "123456789", alienRegistrationNumber: "123456789", ssn: "900123456", uscisOnlineAccountNumber: "123456789012",
  email: "sample.client@example.com", phone: "5551234567", mobilePhone: "5559876543", primaryPhone: "5551234567", ein: "123456789", website: "www.example.com", title: "Director of Operations",
  jobTitle: "Software Engineer", positionTitle: "Software Engineer", salary: "95000", salaryUnit: "Year", line1: "500 Market Street", line2: "Suite 200", city: "San Jose", state: "CA", zip: "95113",
  zipCode: "95113", postalCode: "95113", province: "", country: "United States", number: "A1234567", expirationDate: "2028-06-30", issueDate: "2023-06-30", receiptNumber: "SRC2612345678",
  caseNumber: "CASE-2026-0001", priorityDate: "2025-09-01", businessType: "Software development", yearEstablished: "2012", numberOfEmployees: "85", grossAnnualIncome: "12000000", netAnnualIncome: "1800000",
  lastArrivalDate: "2025-08-20", sevisId: "N0012345678", currentStatus: "H-1B", name: "Acme Technologies Inc.", legalName: "Acme Technologies Inc.",
};

const VISA_BY_FAMILY = { employment: "H-1B", family: "IR-1", single: "F-1", general: "H-1B" };
const root = (path) => String(path).split(".")[0];
const tail = (path) => String(path).replace(/\[\d*\]/g, "").split(".").slice(-1)[0];

// A questionnaire answer is free-form, so the sample is chosen from the words of the question.
const QUESTION_SAMPLES = [
  [/(^| )country( |$)/, "United States"], [/zip|postal/, "95113"], [/state|province/, "CA"], [/city|town/, "San Jose"], [/street|line/, "500 Market Street"],
  [/address/, "500 Market Street Apt 5, San Jose, CA 95113, United States"], [/country|nationality|citizen/, "Mexico"],
  [/e-?mail/, "sample.client@example.com"], [/phone|telephone|mobile/, "5551234567"], [/first|given/, "Maria"], [/middle/, "Elena"], [/last|family|surname/, "Gonzalez"],
  [/date|dob|birth|expir|arriv/, "2026-01-15"], [/a.?number|alien/, "123456789"], [/ssn|social/, "900123456"], [/company|employer|organization/, "Acme Technologies Inc."],
  [/title|position/, "Software Engineer"], [/salary|wage|income/, "95000"], [/number|count|how many/, "2"],
];
function sampleForQuestion(path) {
  const key = String(path).replace(/^raw\.questionnaireAnswers\./, "").split(".").filter((s) => s !== "value" && !/^\d+$/.test(s)).join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  const hit = QUESTION_SAMPLES.find(([pattern]) => pattern.test(key));
  return hit ? hit[1] : "Yes";
}

/** A believable fictional value for a canonical path. */
function sampleValue(path, { family = "general" } = {}) {
  const p = String(path).replace(/\[\d*\]/g, "");
  const r = root(p);
  const last = tail(p);
  if (p === "case.visaType") return VISA_BY_FAMILY[family] || "H-1B";
  if (/^raw\.questionnaireAnswers\./.test(p)) return sampleForQuestion(p);
  const party = ["petitioner", "company", "employer"].includes(r) ? "petitioner" : "beneficiary";
  if (["firstName", "middleName", "lastName", "fullName"].includes(last)) return PEOPLE[/signatory|authorizedRepresentative|contact|petitioner\.[a-z]*Name/.test(p) || party === "petitioner" ? "petitioner" : "beneficiary"][last];
  if (last === "name" && party === "petitioner") return "Acme Technologies Inc.";
  if (party === "petitioner" && /address/i.test(p) && ["line1", "city", "state", "zip", "country"].includes(last)) return BY_TAIL[last];
  if (BY_TAIL[last] !== undefined) return BY_TAIL[last];
  if (/date/i.test(last)) return "2026-01-15";
  if (/email/i.test(last)) return BY_TAIL.email;
  if (/phone/i.test(last)) return BY_TAIL.phone;
  return "Yes";
}

/** Builds a canonical-data object holding a sample value for every path in `paths` (nested like the real canonical profile). */
function buildSampleCanonical(paths, options = {}) {
  const data = {};
  const overrides = options.overrides || {};
  const valueFor = (clean) => (overrides[clean] !== undefined ? overrides[clean] : sampleValue(clean, options));
  for (const path of new Set(paths.filter(Boolean))) {
    const clean = String(path).replace(/\[\d*\]/g, "");
    if (/^raw\./.test(clean)) { MappingResolver.setPath(data, clean.replace(/\.value$/, ""), { value: valueFor(clean) }); continue; }
    MappingResolver.setPath(data, clean, valueFor(clean));
  }
  // the visa type is always present so a "only for visa type X" condition has something to compare
  MappingResolver.setPath(data, "case.visaType", valueFor("case.visaType"));
  return data;
}

/** What the sample client must say for a mapping condition to apply (first option of an "any", every part of an "all"). */
function valuesThatSatisfy(condition, out = {}) {
  if (!condition || typeof condition !== "object") return out;
  if (Array.isArray(condition.all)) { condition.all.forEach((rule) => valuesThatSatisfy(rule, out)); return out; }
  if (Array.isArray(condition.any)) { valuesThatSatisfy(condition.any[0], out); return out; }
  const field = String(condition.field || condition.source || condition.path || "").replace(/^canonicalData\./, "").replace(/\[\d*\]/g, "");
  if (!field || /^filledData\./.test(field)) return out;
  if (condition.operator === "equals" || condition.operator === "==") out[field] = Array.isArray(condition.value) ? condition.value[0] : condition.value;
  else if (condition.operator === "in") out[field] = [].concat(condition.value)[0];
  return out;
}

module.exports = { sampleValue, buildSampleCanonical, valuesThatSatisfy, PEOPLE };
