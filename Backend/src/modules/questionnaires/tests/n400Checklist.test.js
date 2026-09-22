const assert = require("node:assert/strict");
const test = require("node:test");
const { N400_CHECKLIST_DEFINITION } = require("../n400Checklist");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");

// N-400 (Naturalization) - an OPTIONAL add-on immigration process,
// attachable to any existing case regardless of visa type. DB-free,
// following n565Checklist.js's/i131Checklist.js's own established
// convention. Unlike N-565/I-131, this checklist is NOT reached through a
// new CONDITIONAL VisaFormMapping row (see n400Checklist.js's file banner
// for why an exact-visaType-match mechanism is the wrong fit here) - the
// registry-side test below instead confirms the ALREADY-EXISTING N-400
// AUTO_CREATE row (dedicated "Naturalization" case type) is untouched and
// that no new N-400 rows were added anywhere else.

const def = N400_CHECKLIST_DEFINITION;

test("N-400 checklist is client-owned, never default, never a real visaType", () => {
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, false, "must never be auto-resolved without explicit Case Manager approval");
  assert.equal(def.visaType, "N400");
});

test("client-facing title is the general-language process name, never 'N-400 Application'/'Apply for N-400'", () => {
  assert.equal(def.title, "Naturalization / U.S. Citizenship Checklist");
  assert.doesNotMatch(def.title, /N-400/i);
  assert.doesNotMatch(def.title, /apply for/i);
});

test("registry: N-400 already exists (pre-existing AUTO_CREATE row under the dedicated 'Naturalization' case type) and gained no new rows under any other visa type", () => {
  const n400Rows = mappings.filter((m) => m.formNumber === "N-400");
  assert.deepEqual(n400Rows.map((m) => m.visaType), ["Naturalization"]);
  assert.equal(n400Rows[0].provisioningType, "AUTO_CREATE");
  const forbidden = ["IR-1", "CR-1", "F2A", "F2B", "K-1", "K-3", "H-1B", "L-1A", "EB-1A", "EB-2 NIW", "EB-2 PERM", "EB-3 Skilled Worker", "Adjustment of Status", "Green Card Renewal", "Certificate of Citizenship"];
  forbidden.forEach((visaType) => assert.ok(!n400Rows.some((m) => m.visaType === visaType)));
});

test("document checklist matches the source, conditional items are not required-by-default", () => {
  const docs = def.questions.filter((q) => q.type === "file");
  const keys = docs.map((d) => d.key).sort();
  assert.deepEqual(keys, [
    "n400_doc_annulmentCertificates",
    "n400_doc_childrenBirthCertificates",
    "n400_doc_deathCertificates",
    "n400_doc_divorceDecrees",
    "n400_doc_driversLicenseOrStateId",
    "n400_doc_evidenceSpouseCitizenship",
    "n400_doc_foreignPassport",
    "n400_doc_greenCardFrontBack",
    "n400_doc_jointBankCreditStatements",
    "n400_doc_jointInsurancePolicies",
    "n400_doc_jointLeasesMortgages",
    "n400_doc_jointTaxReturns3Years",
    "n400_doc_marriageCertificates",
    "n400_doc_passportPhotos",
    "n400_doc_spousePriorMarriageTerminationDocs",
    "n400_doc_ssnCard",
    "n400_doc_taxReturns5Years",
  ].sort());
  // Core, always-relevant identity/status documents are required; every
  // conditional (marriage-history/marriage-based/outside-USA) document is
  // not required by default - visibility, not "required", carries the
  // conditional gating.
  ["n400_doc_greenCardFrontBack", "n400_doc_foreignPassport", "n400_doc_ssnCard", "n400_doc_taxReturns5Years"].forEach((key) => {
    assert.equal(docs.find((d) => d.key === key).required, true);
  });
  // Marriage-based evidence documents (n400_doc_evidenceSpouseCitizenship
  // etc.) ARE required once their gate is active - "the corresponding
  // evidence...document should become required/active" per the source -
  // asserted separately below; not part of this "optional" check.
  ["n400_doc_passportPhotos", "n400_doc_marriageCertificates"].forEach((key) => {
    assert.equal(docs.find((d) => d.key === key).required, false);
  });
});

test("conditional logic: residing outside the USA gates the passport-photo document", () => {
  const doc = def.questions.find((q) => q.key === "n400_doc_passportPhotos");
  assert.deepEqual(doc.conditionalLogic.rules, [{ questionKey: "client_residingOutsideUsa", operator: "equals", value: "Yes" }]);
});

test("conditional logic: currently married to a U.S. citizen gates the spouse-info fields and 3-year marriage-based evidence documents", () => {
  const spouseGate = [{ questionKey: "client_spouseIsUsCitizen", operator: "equals", value: "Yes" }];
  ["client_spouse_lastName", "client_spouse_firstName", "client_spouse_dateBecameUsCitizen", "client_spouse_howBecameUsCitizen"].forEach((key) => {
    const q = def.questions.find((question) => question.key === key);
    assert.deepEqual(q.conditionalLogic.rules, spouseGate, `${key} must be gated on spouseIsUsCitizen`);
  });
  ["n400_doc_evidenceSpouseCitizenship", "n400_doc_jointBankCreditStatements", "n400_doc_jointLeasesMortgages", "n400_doc_jointInsurancePolicies", "n400_doc_jointTaxReturns3Years"].forEach((key) => {
    const doc = def.questions.find((question) => question.key === key);
    assert.deepEqual(doc.conditionalLogic.rules, spouseGate, `${key} must be gated on spouseIsUsCitizen`);
    assert.equal(doc.required, true);
  });
});

test("conditional logic: father/mother U.S. citizen gates each parent's own info fields independently", () => {
  const fatherGate = [{ questionKey: "client_fatherIsUsCitizen", operator: "equals", value: "Yes" }];
  const motherGate = [{ questionKey: "client_motherIsUsCitizen", operator: "equals", value: "Yes" }];
  ["client_father_lastName", "client_father_dateBecameUsCitizen", "client_father_aNumber"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, fatherGate);
  });
  ["client_mother_lastName", "client_mother_dateBecameUsCitizen", "client_mother_aNumber"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, motherGate);
  });
});

test("conditional logic: ever-married (not single/never married) gates the marriage-history document set", () => {
  const gateRules = [{ questionKey: "client_currentMaritalStatus", operator: "not_equals", value: "Single, Never Married" }];
  ["n400_doc_marriageCertificates", "n400_doc_divorceDecrees", "n400_doc_annulmentCertificates", "n400_doc_deathCertificates"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, gateRules);
  });
});

test("Section 2/3/5/7 are real repeatable structured tables, not free text", () => {
  const repeatableKeys = ["client_residentialHistory", "client_employmentHistory", "client_travelHistory", "client_children"];
  repeatableKeys.forEach((key) => {
    const q = def.questions.find((question) => question.key === key);
    assert.equal(q.type, "repeating_group");
    assert.ok(q.repeatable);
    assert.ok(Array.isArray(q.metadata.fields) && q.metadata.fields.length > 0, `${key} must carry its row columns`);
  });
  const residential = def.questions.find((q) => q.key === "client_residentialHistory");
  assert.deepEqual(residential.metadata.fields.map((f) => f.key), ["streetAndNumber", "city", "stateProvince", "country", "fromMonth", "fromYear", "toMonth", "toYear"]);
  const employment = def.questions.find((q) => q.key === "client_employmentHistory");
  assert.deepEqual(employment.metadata.fields.map((f) => f.key), ["employerName", "employerAddress", "occupation", "fromMonth", "fromYear", "toMonth", "toYear"]);
  const travel = def.questions.find((q) => q.key === "client_travelHistory");
  assert.deepEqual(travel.metadata.fields.map((f) => f.key), ["dateLeftUS", "dateReturnedUS", "tripLastedSixMonthsOrMore", "countriesVisited", "totalDaysOutsideUS"]);
  const children = def.questions.find((q) => q.key === "client_children");
  assert.deepEqual(children.metadata.fields.map((f) => f.key), ["lastName", "firstName", "middleName", "dateOfBirth", "currentAddress", "relationshipToApplicant"]);
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

test("field catalog spot-check: personal information section fields present", () => {
  const keys = new Set(def.questions.map((q) => q.key));
  ["client_lastName", "client_nameOnGreenCard", "client_aNumber", "client_dateBecameLpr", "client_uscisOnlineAccountNumber", "client_totalDaysOutsideUs5Years", "client_totalNumberOfChildren"]
    .forEach((key) => assert.ok(keys.has(key), `${key} missing from N-400 checklist`));
});
