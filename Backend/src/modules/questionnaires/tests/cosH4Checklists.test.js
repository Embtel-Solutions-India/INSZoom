// DB-free checks of the Change of Status to H-4 filing: exact wording, answer types, canonical targets, optionality, conditional application-type fields,
// the review flag on "Reinstatement to student status", the transition picker and the registry seed rows.
const assert = require("node:assert/strict");
const test = require("node:test");
const { COS_H4_CHECKLIST_DEFINITIONS, APPLICATION_TYPE_OPTIONS } = require("../cosH4Checklist");
const { resolveTransitionFilingType, getFilingType } = require("../../../config/filingTypes");
const { VISA_CATEGORIES } = require("../../../config/visaCategories");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const { H4_CANONICAL_FIELDS } = require("../../canonical/config/h4CanonicalPaths");
const PartyAlias = require("../../canonical/services/PartyAliasService");

const [definition] = COS_H4_CHECKLIST_DEFINITIONS;
const byLabel = new Map(definition.questions.map((question) => [question.label, question]));
const get = (label) => { const question = byLabel.get(label); assert.ok(question, `missing: ${label}`); return question; };

test("H-4 is a change-of-status destination from any current status", () => {
  assert.equal(resolveTransitionFilingType("F-1", "H-4").key, "COS_H4");
  assert.equal(resolveTransitionFilingType("L-1A", "H-4").key, "COS_H4");
  assert.equal(resolveTransitionFilingType(null, "H-4").key, "COS_H4");
  const filing = getFilingType("COS_H4");
  assert.equal(filing.visaType, "COSH4");
  assert.equal(filing.questionnaireKey, definition.key);
  assert.equal(VISA_CATEGORIES.COSH4.caseStructure, "single");
});

test("exact section A-D questions, types and canonical targets", () => {
  const expect = [
    ["Family Name (Last Name):", "text", "person.lastName"], ["Given Name:", "text", "person.firstName"], ["Middle Name:", "text", "person.middleName"],
    ["Alien Registration Number (A-Number) if any:", "text", "person.alienNumber"], ["USCIS Online Account Number (if any):", "text", "person.uscisOnlineAccountNumber"],
    ["US Mailing Address:", "address", "beneficiary.usMailingAddress"], ["US Physical Address (If different from Mailing Address):", "address", "beneficiary.usPhysicalAddress"],
    ["Country of Birth:", "select", "person.countryOfBirth"], ["Country of Citizenship:", "select", "person.citizenship"], ["Date of Birth:", "date", "person.dob"],
    ["U.S. Social Security Number (if any):", "text", "person.ssn"], ["Applicant's Daytime Telephone Number:", "phone", "contact.phone"], ["Applicant's Email Address:", "email", "contact.email"],
    ["Date of Last Arrival Into the United States(mm/dd/yyyy):", "date", "immigration.lastArrivalDate"], ["I-94 Arrival-Departure Record Number:", "text", "immigration.i94.number"],
    ["Passport Number:", "text", "person.passport.number"], ["Country of Passport Issuance:", "select", "person.passport.country"], ["Passport Expiration Date:", "date", "person.passport.expirationDate"],
    ["Current Nonimmigrant Status(e.g. F-1 student, H-4 dependent, etc.):", "text", "immigration.currentStatus"], ["Expiration Date of Current Status (mm/dd/yyyy):", "date", "immigration.currentStatusExpirationDate"],
    ["Street Number and Name -", "text", "beneficiary.foreignAddress.streetAddress"], ["City or Town:", "text", "beneficiary.foreignAddress.city"], ["State:", "text", "beneficiary.foreignAddress.state"],
    ["Postal Code:", "text", "beneficiary.foreignAddress.postalCode"], ["Province:", "text", "beneficiary.foreignAddress.province"], ["Country:", "select", "beneficiary.foreignAddress.country"],
  ];
  expect.forEach(([label, type, path]) => { const question = get(label); assert.equal(question.type, type, label); assert.equal(question.mapping.canonicalPath, path, label); });
  assert.equal(get("U.S. Social Security Number (if any):").metadata.sensitive, true);
});

test("application type: exact single-select options, conditional change-of-status fields, reinstatement flagged", () => {
  const application = get("I am applying for (select only one)");
  assert.equal(application.type, "radio");
  assert.deepEqual(application.options.map((o) => o.value), ["Reinstatement to student status", "An extension of stay in my current status", "Change of status"]);
  assert.deepEqual(APPLICATION_TYPE_OPTIONS, application.options.map((o) => o.value));
  assert.equal(application.mapping.canonicalPath, "application.applicationType");
  assert.equal(application.metadata.optionFlags["Reinstatement to student status"], "case_manager_review");
  const rule = application.validationRules[0];
  assert.equal(rule.severity, "warning", "selecting reinstatement warns, it never blocks");
  assert.ok(!new RegExp(rule.value).test("Reinstatement to student status") && new RegExp(rule.value).test("Change of status"));
  const record = get("New status and effective date of change (mm/dd/yyyy):");
  assert.equal(record.conditionalLogic.rules[0].value, "Change of status");
  assert.deepEqual(record.metadata.repeatableFields.map((f) => f.canonicalPath), ["application.requestedStatus", "application.requestedStatusEffectiveDate"]);
  assert.equal(get("The change of status I am requesting is:").conditionalLogic.rules[0].value, "Change of status");
});

test("documents: exact labels, the H-1B principal item is tagged as the principal's", () => {
  ["Copy of passport and I-94", "Copy of SSN (if any)", "Copy of EAD card (if any)", "Copy of driver’s license or state identification card", "Copy of all approval notices",
    "Evidence of relationship to H1B visa holder (for example birth certificate, marriage certificate)"].forEach((label) => assert.equal(get(label).type, "file", label));
  const principal = get("Copy of passport, latest 3 paystubs and latest approval notice of H1B visa holder");
  assert.equal(principal.mapping.canonicalPath, "principalH1B.documents.passportPaystubsAndLatestApprovalNotice");
  assert.equal(principal.metadata.documentOwner, "h1b_principal");
  assert.ok(definition.sections.includes("If applying for H4, then provide the following documents as well:"));
  assert.ok(!get("Copy of passport and I-94").metadata.documentOwner, "the beneficiary's own passport/I-94 are not tagged as the principal's");
});

test("everything optional; targets registered or shared; documents keyed by documentType", () => {
  const registered = new Set(H4_CANONICAL_FIELDS.map((f) => f.path));
  definition.questions.forEach((question) => {
    assert.equal(question.required, false, question.key);
    assert.equal(question.metadata.optional, true, question.key);
    assert.ok(question.mapping?.canonicalPath, question.key);
    if (question.type === "file") assert.equal(question.metadata.documentType, question.key);
    if (/^(application|principalH1B)\./.test(question.mapping.canonicalPath) || /documents\./.test(question.mapping.canonicalPath)) assert.ok(registered.has(question.mapping.canonicalPath), question.mapping.canonicalPath);
  });
});

test("registry: I-539 automatic; G-28 / I-907 / I-765 conditional; no DS-160 / I-129", () => {
  const rows = mappings.filter((m) => m.visaType === "COSH4");
  const by = Object.fromEntries(rows.map((m) => [m.formNumber, m]));
  assert.equal(by["I-539"].provisioningType, "AUTO_CREATE");
  ["G-28", "I-907", "I-765"].forEach((code) => assert.equal(by[code].provisioningType, "CONDITIONAL", code));
  assert.ok(!by["DS-160"] && !by["I-129"]);
});

test("the requested status record is split into its two canonical paths", () => {
  const profile = PartyAlias.apply({ case: { caseStructure: "single" }, application: { requestedStatusRecord: [{ status: "H-4", effectiveDate: "2026-12-01" }] }, person: { firstName: "Ada" } });
  assert.equal(profile.application.requestedStatus, "H-4");
  assert.equal(profile.application.requestedStatusEffectiveDate, "2026-12-01");
  assert.equal(profile.beneficiary.firstName, "Ada", "a single-party filing's applicant is exposed as beneficiary.* too");
});
