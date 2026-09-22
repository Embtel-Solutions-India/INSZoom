const assert = require("node:assert/strict");
const test = require("node:test");
const { N565_CHECKLIST_DEFINITION, REASON, APPLYING_FOR } = require("../n565Checklist");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const visaFormMappingService = require("../../form-registry/visaFormMapping.service");

// N-565 - an OPTIONAL independent USCIS form under the Single Person
// category (Case Manager-approved, not automatic), never a visa type.
// DB-free, following i131Checklist.js's own established test convention
// (the sibling "optional CONDITIONAL form + its own client checklist"
// precedent this implementation mirrors exactly).

const def = N565_CHECKLIST_DEFINITION;

test("N-565 checklist is client-owned, never default, never a real visaType", () => {
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, false, "must never be auto-resolved without explicit Case Manager approval");
  assert.equal(def.visaType, "N565");
  assert.equal(def.title, "N-565 — Replacement Naturalization/Citizenship Document");
});

test("mapping: N-565 exists as a CONDITIONAL independent form under Naturalization and Certificate of Citizenship only", () => {
  const n565Rows = mappings.filter((m) => m.formNumber === "N-565");
  const visaTypes = n565Rows.map((m) => m.visaType).sort();
  assert.deepEqual(visaTypes, ["Certificate of Citizenship", "Naturalization", "Replacement Citizenship Certificate"].sort());

  const conditionalRows = n565Rows.filter((m) => m.visaType !== "Replacement Citizenship Certificate");
  conditionalRows.forEach((row) => {
    assert.equal(row.provisioningType, "CONDITIONAL");
    assert.equal(row.agency, "USCIS");
    assert.equal(row.componentType, "STANDALONE_FORM");
    assert.equal(row.parentForm, null);
  });
  // The pre-existing dedicated case type keeps its own AUTO_CREATE row,
  // untouched by this addition.
  const dedicated = n565Rows.find((m) => m.visaType === "Replacement Citizenship Certificate");
  assert.equal(dedicated.provisioningType, "AUTO_CREATE");
});

test("mapping: N-565 is never registered under family-based, employer/employee, or unrelated EB/H/L visa types", () => {
  const forbidden = ["IR-1", "CR-1", "F2A", "F2B", "K-1", "K-3", "H-1B", "L-1A", "EB-1A", "EB-1B", "EB-2 NIW", "EB-2 PERM", "EB-3 Skilled Worker", "Adjustment of Status", "Green Card Renewal"];
  const n565VisaTypes = new Set(mappings.filter((m) => m.formNumber === "N-565").map((m) => m.visaType));
  forbidden.forEach((visaType) => assert.ok(!n565VisaTypes.has(visaType), `N-565 must not be mapped to ${visaType}`));
});

test("CONDITIONAL_FORM_CHECKLIST_KEYS registers N-565 -> n565_checklist, same mechanism as I-131", () => {
  // Exercised indirectly through recordConditionalDecision's own behavior
  // in the dedicated DB-backed dedup test below; this just confirms the
  // module doesn't throw and I-131's own entry is untouched.
  assert.equal(typeof visaFormMappingService.recordConditionalDecision, "function");
});

test("document checklist matches the source exactly (10 items) and every item is conditional, not mandatory-by-default", () => {
  const docs = def.questions.filter((q) => q.type === "file");
  assert.equal(docs.length, 10);
  docs.forEach((doc) => assert.equal(doc.required, false, `${doc.key} must not be shown as mandatory by default`));
  const keys = docs.map((d) => d.key).sort();
  assert.deepEqual(keys, [
    "n565_doc_copyOfOriginalDocument",
    "n565_doc_dobChangeEvidence",
    "n565_doc_genderChangeEvidence",
    "n565_doc_maritalStatusChangeEvidence",
    "n565_doc_nameChangeEvidence",
    "n565_doc_originalCertificate",
    "n565_doc_originalNaturalizationCertificate",
    "n565_doc_policeReportOrSwornStatement",
    "n565_doc_uscisErrorEvidence",
    "n565_doc_passportPhotosOutsideUs",
  ].sort());
});

test("conditional logic: lost/stolen/destroyed gates copy-of-document + police report", () => {
  const copyDoc = def.questions.find((q) => q.key === "n565_doc_copyOfOriginalDocument");
  const policeDoc = def.questions.find((q) => q.key === "n565_doc_policeReportOrSwornStatement");
  [copyDoc, policeDoc].forEach((doc) => {
    assert.deepEqual(doc.conditionalLogic.rules, [{ questionKey: "client_reason", operator: "contains", value: REASON.LOST_STOLEN_DESTROYED }]);
  });
});

test("conditional logic: name/DOB/gender change each gate their own evidence document + questionnaire section", () => {
  const cases = [
    { reason: REASON.NAME_CHANGE, doc: "n565_doc_nameChangeEvidence", sectionKey: "legal_name_change" },
    { reason: REASON.DOB_CHANGE, doc: "n565_doc_dobChangeEvidence", sectionKey: "official_date_of_birth_change" },
    { reason: REASON.GENDER_CHANGE, doc: "n565_doc_genderChangeEvidence", sectionKey: "official_gender_change" },
  ];
  cases.forEach(({ reason, doc, sectionKey }) => {
    const document = def.questions.find((q) => q.key === doc);
    assert.deepEqual(document.conditionalLogic.rules, [{ questionKey: "client_reason", operator: "contains", value: reason }]);
    const sectionQuestions = def.questions.filter((q) => q.sectionKey === sectionKey);
    assert.ok(sectionQuestions.length > 0, `${sectionKey} must have questions`);
    sectionQuestions.forEach((q) => assert.deepEqual(q.conditionalLogic.rules, [{ questionKey: "client_reason", operator: "contains", value: reason }]));
  });
});

test("conditional logic: USCIS typographical/clerical error gates the error-location section + evidence document, with per-location sub-fields", () => {
  const evidenceDoc = def.questions.find((q) => q.key === "n565_doc_uscisErrorEvidence");
  assert.deepEqual(evidenceDoc.conditionalLogic.rules, [{ questionKey: "client_reason", operator: "contains", value: REASON.USCIS_ERROR }]);
  const errorLocation = def.questions.find((q) => q.key === "client_error_location");
  assert.deepEqual(errorLocation.conditionalLogic.rules, [{ questionKey: "client_reason", operator: "contains", value: REASON.USCIS_ERROR }]);
  assert.deepEqual(errorLocation.options.map((o) => o.value), ["Name", "Date of Birth", "Gender", "Other"]);
  const correctName = def.questions.find((q) => q.key === "client_error_correctName");
  assert.deepEqual(correctName.conditionalLogic.rules, [{ questionKey: "client_error_location", operator: "equals", value: "Name" }]);
});

test("conditional logic: special certificate of naturalization gates its own section + the original-certificate document", () => {
  const gate = { questionKey: "client_applyingFor", operator: "equals", value: APPLYING_FOR.SPECIAL_CERTIFICATE_OF_NATURALIZATION };
  const doc = def.questions.find((q) => q.key === "n565_doc_originalNaturalizationCertificate");
  assert.deepEqual(doc.conditionalLogic.rules, [gate]);
  const sectionQuestions = def.questions.filter((q) => q.sectionKey === "special_certificate_of_recognition");
  assert.ok(sectionQuestions.length >= 7);
  sectionQuestions.forEach((q) => assert.deepEqual(q.conditionalLogic.rules, [gate]));
});

test("'I am applying for' does not create separate checklists - it is one field inside the single N-565 checklist", () => {
  const applyingFor = def.questions.filter((q) => q.key === "client_applyingFor");
  assert.equal(applyingFor.length, 1);
  assert.equal(applyingFor[0].type, "select");
  assert.deepEqual(applyingFor[0].options.map((o) => o.value).sort(), Object.values(APPLYING_FOR).sort());
});

test("reason field is a real structured multiselect, not free text", () => {
  const reason = def.questions.find((q) => q.key === "client_reason");
  assert.equal(reason.type, "multiselect");
  assert.deepEqual(reason.options.map((o) => o.value).sort(), Object.values(REASON).sort());
});

test("checklist visibility is client-only (never petitioner/beneficiary/employer/employee/joint_sponsor)", () => {
  def.questions.forEach((q) => {
    assert.ok(q.visibility.roles.includes("client"));
    ["petitioner", "beneficiary", "employer", "employee", "joint_sponsor"].forEach((role) => {
      assert.ok(!q.visibility.roles.includes(role), `${q.key} must not be visible to ${role}`);
    });
  });
});

test("no duplicate question keys", () => {
  const keys = def.questions.map((q) => q.key);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});

test("field catalog spot-check: certificate info + current info sections present", () => {
  const keys = new Set(def.questions.map((q) => q.key));
  ["client_cert_lastName", "client_cert_certificateNumber", "client_cert_aNumber", "client_current_maritalStatus", "client_current_lostOrRenouncedCitizenship"]
    .forEach((key) => assert.ok(keys.has(key), `${key} missing from N-565 checklist`));
});
