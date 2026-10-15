// DB-free checks of the I-824 case type: exact labels / answer types / canonical paths, optionality, person ownership (principal immigrant lives ONLY in the
// petitioner checklist), exactly two checklists assigned, and the registry rows (Form I-824 core, G-28 conditional, nothing else).
const assert = require("node:assert/strict");
const test = require("node:test");
const { I824_CHECKLIST_DEFINITIONS, PETITIONER_TITLE, BENEFICIARY_TITLE, IMMIGRATION_STATUS_OPTIONS } = require("../i824Checklist");
const { resolveFamilyChecklistKeys } = require("../familyChecklists");
const { VISA_CATEGORIES } = require("../../../config/visaCategories");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const { I824_CANONICAL_FIELDS } = require("../../canonical/config/i824CanonicalPaths");
const { FIELDS: REGISTRY_FIELDS } = (() => { try { return require("../../form-mapping/services/CanonicalFieldRegistryService"); } catch (_) { return {}; } })();

const [petitioner, beneficiary] = I824_CHECKLIST_DEFINITIONS;
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const inSection = (definition, section) => definition.questions.filter((question) => question.sectionKey === slug(section));

test("I-824 is a family-structure case type with the exact label", () => {
  assert.equal(VISA_CATEGORIES["I-824"].label, "I-824");
  assert.equal(VISA_CATEGORIES["I-824"].caseStructure, "family");
  assert.equal(Object.keys(VISA_CATEGORIES).filter((key) => /^i-?824$/i.test(key)).length, 1, "no duplicate I-824 case type");
});

test("exactly two checklists, with the exact display names", () => {
  assert.equal(I824_CHECKLIST_DEFINITIONS.length, 2);
  assert.equal(petitioner.title, "I-824 — Petitioner Checklist");
  assert.equal(beneficiary.title, "I-824 — Beneficiary Checklist");
  assert.equal(PETITIONER_TITLE, petitioner.title);
  assert.equal(BENEFICIARY_TITLE, beneficiary.title);
  assert.deepEqual(I824_CHECKLIST_DEFINITIONS.map((definition) => definition.checklistRole), ["petitioner", "beneficiary"]);
  assert.ok(!I824_CHECKLIST_DEFINITIONS.some((definition) => /principal/i.test(definition.key)), "no separate principal-immigrant checklist");
});

test("case creation assigns exactly the two checklists, for either spelling, on every filing path (and is deterministic, so retries never add a third)", () => {
  const expected = ["i824_petitioner_checklist", "i824_beneficiary_checklist"];
  ["I-824", "I824", "i-824"].forEach((visaType) => {
    ["", "PETITION_ONLY", "CONSULAR", "ADJUSTMENT_OF_STATUS"].forEach((path) => assert.deepEqual(resolveFamilyChecklistKeys(visaType, path), expected));
  });
  assert.notDeepEqual(resolveFamilyChecklistKeys("IR-1", "PETITION_ONLY"), expected, "other family types are unaffected");
});

test("petitioner checklist: exact questions, types and canonical paths", () => {
  const expectPairs = [
    ["Last Name", "text", "petitioner.lastName"], ["First Name", "text", "petitioner.firstName"], ["Middle Name", "text", "petitioner.middleName"],
    ["Date of Birth", "date", "petitioner.dateOfBirth"], ["Country of Birth", "select", "petitioner.countryOfBirth"], ["Country of Citizenship", "select", "petitioner.countryOfCitizenship"],
    ["Company or Organization Name (if any)", "text", "petitioner.organizationName"],
    ["Current Immigration Status (US Citizen or Lawful Permanent Resident)", "select", "petitioner.currentImmigrationStatus"],
    ["Certificate of Naturalization/ Citizenship Number (if any)", "text", "petitioner.citizenshipCertificateNumber"], ["A Number (if any)", "text", "petitioner.aNumber"],
    ["IRS Tax Number (if any)", "text", "petitioner.irsTaxNumber"], ["Social Security Number", "text", "petitioner.ssn"],
    ["USCIS Online Account Number", "text", "petitioner.uscisOnlineAccountNumber"], ["Mailing Address", "address", "petitioner.mailingAddress"],
    ["Physical Address (if different from Mailing Address)", "address", "petitioner.physicalAddress"],
  ];
  const section = inSection(petitioner, "Information about the Petitioner");
  assert.equal(section.length, expectPairs.length);
  expectPairs.forEach(([label, type, path], index) => { assert.equal(section[index].label, label); assert.equal(section[index].type, type, label); assert.equal(section[index].mapping.canonicalPath, path, label); });
  assert.deepEqual(section.find((question) => question.label.startsWith("Current Immigration")).options.map((option) => option.value), IMMIGRATION_STATUS_OPTIONS);
  assert.equal(section.find((question) => question.label === "Social Security Number").metadata.sensitive, true);
  assert.equal(section.find((question) => question.label.startsWith("IRS Tax")).metadata.sensitive, true);
});

test("principal applicant answers belong to the petitioner checklist, under principalImmigrant.*", () => {
  const section = inSection(petitioner, "Information about the Principal Applicant");
  assert.deepEqual(section.map((question) => question.mapping.canonicalPath), [
    "principalImmigrant.lastName", "principalImmigrant.firstName", "principalImmigrant.middleName", "principalImmigrant.dateOfBirth", "principalImmigrant.countryOfBirth",
    "principalImmigrant.countryOfCitizenship", "principalImmigrant.aNumber", "principalImmigrant.daytimeTelephoneNumber", "principalImmigrant.mailingAddress", "principalImmigrant.physicalAddress",
  ]);
  assert.equal(section.find((question) => question.label === "Daytime Telephone Number").type, "phone");
  assert.ok(!beneficiary.questions.some((question) => /principalImmigrant|petitioner\./.test(question.mapping.canonicalPath)), "the beneficiary checklist never carries petitioner / principal data");
});

test("documents: exact labels and namespaces; principal documents are owner-tagged, in their own section", () => {
  const petitionerDocs = inSection(petitioner, "Documents required from Petitioner");
  assert.deepEqual(petitionerDocs.map((question) => question.label), [
    "Copy of Naturalization/ Citizenship certificate", "Copy of green card (front and back), if applicable", "Copy of passport of the petitioner", "Copy of SSN",
    "Copy of driver's license or State Identification card", "Copy of the I-130 approval notice",
  ]);
  assert.deepEqual(petitionerDocs.map((question) => question.mapping.canonicalPath), [
    "petitioner.documents.citizenshipCertificate", "petitioner.documents.greenCard", "petitioner.documents.passport", "petitioner.documents.ssnCard", "petitioner.documents.stateId", "petitioner.documents.i130ApprovalNotice",
  ]);
  const principalDocs = inSection(petitioner, "Documents required from Principal Immigrant");
  assert.equal(principalDocs.length, 5);
  principalDocs.forEach((question) => {
    assert.equal(question.type, "file");
    assert.ok(question.mapping.canonicalPath.startsWith("principalImmigrant.documents."), question.key);
    assert.equal(question.metadata.documentOwner, "principal_immigrant", `${question.key} must be filed as the principal's, never the petitioner's`);
  });
  assert.ok(petitionerDocs.every((question) => !question.metadata.documentOwner));
  assert.equal(principalDocs.at(-1).label, "Evidence of relationship with both petitioner and beneficiary (such as marriage certificate, birth certificate)");
  assert.deepEqual(inSection(beneficiary, "Documents required from Beneficiary").map((question) => question.mapping.canonicalPath), ["beneficiary.documents.passport", "beneficiary.documents.relationshipEvidence"]);
});

test("beneficiary checklist: exact questions, types and canonical paths", () => {
  const section = inSection(beneficiary, "Information about the Beneficiary(s)");
  assert.deepEqual(section.map((question) => [question.label, question.type, question.mapping.canonicalPath]), [
    ["Last Name", "text", "beneficiary.lastName"], ["First Name", "text", "beneficiary.firstName"], ["Middle Name", "text", "beneficiary.middleName"],
    ["Date of Birth", "date", "beneficiary.dateOfBirth"], ["Country of Birth", "select", "beneficiary.countryOfBirth"], ["Country of Citizenship", "select", "beneficiary.countryOfCitizenship"],
    ["Relationship to Principal Applicant", "text", "beneficiary.relationshipToPrincipalApplicant"], ["Daytime Telephone Number", "phone", "beneficiary.daytimeTelephoneNumber"],
    ["Foreign Telephone Number", "phone", "beneficiary.foreignTelephoneNumber"], ["Email id", "email", "beneficiary.email"], ["Outside US Address of beneficiary", "address", "beneficiary.foreignAddress"],
  ]);
});

test("every question and upload is optional; document questions keyed by documentType; keys unique", () => {
  const registered = new Set(I824_CANONICAL_FIELDS.map((field) => field.path));
  I824_CHECKLIST_DEFINITIONS.flatMap((definition) => definition.questions).forEach((question) => {
    assert.equal(question.required, false, question.key);
    assert.equal(question.metadata.optional, true, question.key);
    if (question.type === "file") { assert.equal(question.metadata.documentType, question.key); assert.ok(registered.has(question.mapping.canonicalPath), question.mapping.canonicalPath); }
  });
  const keys = I824_CHECKLIST_DEFINITIONS.flatMap((definition) => definition.questions.map((question) => question.key));
  assert.equal(new Set(keys).size, keys.length, "question keys are unique across both checklists");
});

test("registry: Form I-824 is the core USCIS form, G-28 conditional, no I-130 / I-485 / I-864 / I-129 or DOS form", () => {
  const rows = mappings.filter((mapping) => mapping.visaType === "I-824");
  const by = Object.fromEntries(rows.map((row) => [row.formNumber, row]));
  assert.equal(by["I-824"].provisioningType, "AUTO_CREATE");
  assert.equal(by["I-824"].agency, "USCIS");
  assert.equal(by["G-28"].provisioningType, "CONDITIONAL");
  assert.deepEqual(rows.map((row) => row.formNumber).sort(), ["G-28", "I-824"]);
  assert.ok(rows.every((row) => row.agency === "USCIS"), "no DOS / non-USCIS form is presented as a USCIS form");
});

test("registry checklist mappings: exactly the two I-824 checklists, by role", () => {
  const { ENTRIES } = require("../../form-registry/seeds/checklistMappings.seed");
  const entry = ENTRIES.find((item) => item.visaType === "I-824" && item.formNumber === "I-824");
  assert.deepEqual(entry.checklistMappings.map((item) => [item.checklistKey, item.role, item.assignmentType]), [
    ["i824_petitioner_checklist", "petitioner", "AUTO"], ["i824_beneficiary_checklist", "beneficiary", "AUTO"],
  ]);
  assert.ok(!ENTRIES.some((item) => item.visaType === "I-824" && item.formNumber !== "I-824"), "no other form carries an I-824 checklist");
});
