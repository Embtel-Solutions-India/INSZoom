const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const visaFormMappingService = require("../visaFormMapping.service");

// Minimal fake rows, shaped like real VisaFormMapping documents, covering
// exactly the acceptance tests in the VisaFormMapping architecture
// correction plan. Mocking VisaFormMapping.find (mirrors
// cases/tests/checklist-dedup.test.js's style) keeps this test DB-free and
// fast, while exercising the real resolveApplicableMappings/
// resolveVisaFormMappings/isIndependentUSCISForm/independentFormsFrom code.
function row(overrides) {
  return {
    _id: overrides.formNumber + ":" + overrides.visaType,
    active: true,
    provisioningType: "AUTO_CREATE",
    processingPaths: [],
    triggerCondition: null,
    parentForm: null,
    ...overrides,
  };
}

const FAKE_DB = [
  row({ visaType: "H-1B", formNumber: "I-129", formName: "Petition for a Nonimmigrant Worker", agency: "USCIS", componentType: "STANDALONE_FORM" }),
  row({ visaType: "H-1B", formNumber: "I-129 H Classification Supplement", formName: "H Supplement", agency: "USCIS", componentType: "FORM_COMPONENT", provisioningType: "NOT_APPLICABLE", parentForm: "I-129" }),
  row({ visaType: "H-1B", formNumber: "H-1B Data Collection and Filing Fee Exemption Supplement", formName: "Data Collection Supplement", agency: "USCIS", componentType: "FORM_COMPONENT", provisioningType: "NOT_APPLICABLE", parentForm: "I-129" }),
  row({ visaType: "H-1B", formNumber: "ETA-9035", formName: "LCA", agency: "DOL", componentType: "ONLINE_APPLICATION" }),
  row({ visaType: "H-1B", formNumber: "DS-160", formName: "Online Nonimmigrant Visa Application", agency: "DOS", componentType: "ONLINE_APPLICATION", provisioningType: "CONDITIONAL" }),

  row({ visaType: "P-1", formNumber: "I-129", formName: "Petition for a Nonimmigrant Worker", agency: "USCIS", componentType: "STANDALONE_FORM" }),
  row({ visaType: "P-1", formNumber: "I-129 O/P Classification Supplement", formName: "O/P Supplement", agency: "USCIS", componentType: "FORM_COMPONENT", provisioningType: "NOT_APPLICABLE", parentForm: "I-129" }),

  row({ visaType: "L-1A", formNumber: "I-129", formName: "Petition for a Nonimmigrant Worker", agency: "USCIS", componentType: "STANDALONE_FORM" }),

  row({ visaType: "EB-2 NIW", formNumber: "I-140", formName: "Immigrant Petition for Alien Worker", agency: "USCIS", componentType: "STANDALONE_FORM" }),

  row({ visaType: "EB-5 Regional Center", formNumber: "I-526E", formName: "Immigrant Petition by Regional Center Investor", agency: "USCIS", componentType: "STANDALONE_FORM" }),
  row({ visaType: "EB-5 Standalone", formNumber: "I-526", formName: "Immigrant Petition by Alien Investor", agency: "USCIS", componentType: "STANDALONE_FORM" }),

  row({ visaType: "IR-1", formNumber: "I-130", formName: "Petition for Alien Relative", agency: "USCIS", componentType: "STANDALONE_FORM" }),
  row({ visaType: "IR-1", formNumber: "I-130A", formName: "Supplemental Information for Spouse Beneficiary", agency: "USCIS", componentType: "SUPPLEMENT", parentForm: "I-130", provisioningType: "CONDITIONAL" }),

  row({ visaType: "L-2", formNumber: "I-539", formName: "Application to Extend/Change Nonimmigrant Status", agency: "USCIS", componentType: "STANDALONE_FORM", provisioningType: "CONDITIONAL" }),
  row({ visaType: "L-2", formNumber: "I-539A", formName: "Supplemental Information for I-539", agency: "USCIS", componentType: "SUPPLEMENT", parentForm: "I-539", provisioningType: "CONDITIONAL" }),

  row({ visaType: "I-20", formNumber: "I-20", formName: "Certificate of Eligibility", agency: "SCHOOL_OR_PROGRAM_SPONSOR", componentType: "REFERENCE_DOCUMENT", provisioningType: "REFERENCE" }),
];

function mockFind(query) {
  const results = FAKE_DB.filter((r) => r.visaType === query.visaType && r.active === query.active);
  return { lean: async () => results };
}

test("H-1B resolves to I-129 only (independent forms) - excludes both I-129 supplements and DS-160/ETA-9035", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", mockFind);
  const resolved = await visaFormMappingService.resolveVisaFormMappings({ visaType: "H-1B" });
  const independent = visaFormMappingService.independentFormsFrom(resolved);
  assert.deepEqual(independent.map((e) => e.mapping.formNumber), ["I-129"]);
  assert.equal(resolved.usedParentFallback, false);
});

test("P-1A/P-1B with no dedicated mapping inherit P-1's I-129, without a fake P-1A row", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", mockFind);
  for (const visaType of ["P-1A", "P-1B"]) {
    const resolved = await visaFormMappingService.resolveVisaFormMappings({ visaType });
    const independent = visaFormMappingService.independentFormsFrom(resolved);
    assert.deepEqual(independent.map((e) => e.mapping.formNumber), ["I-129"]);
    assert.equal(resolved.usedParentFallback, true);
    assert.equal(resolved.resolvedVisaType, "P-1");
  }
});

test("L-1A has its own dedicated mapping and never falls back to a generic L-1", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", mockFind);
  const resolved = await visaFormMappingService.resolveVisaFormMappings({ visaType: "L-1A" });
  assert.equal(resolved.usedParentFallback, false);
  assert.equal(resolved.resolvedVisaType, "L-1A");
});

test("EB-2 NIW uses its own dedicated mapping, never EB-2 PERM's", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", mockFind);
  const resolved = await visaFormMappingService.resolveVisaFormMappings({ visaType: "EB-2 NIW" });
  const independent = visaFormMappingService.independentFormsFrom(resolved);
  assert.deepEqual(independent.map((e) => e.mapping.formNumber), ["I-140"]);
});

test("generic EB-2 (no exact mapping, no parent registered) is reported unresolved, never guesses NIW/PERM", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", mockFind);
  const resolved = await visaFormMappingService.resolveVisaFormMappings({ visaType: "EB-2" });
  assert.equal(resolved.unresolved, true);
  assert.deepEqual(visaFormMappingService.independentFormsFrom(resolved), []);
});

test("EB-5 Regional Center and Standalone resolve to distinct forms, no arbitrary default", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", mockFind);
  const rc = await visaFormMappingService.resolveVisaFormMappings({ visaType: "EB-5 Regional Center" });
  const standalone = await visaFormMappingService.resolveVisaFormMappings({ visaType: "EB-5 Standalone" });
  assert.deepEqual(visaFormMappingService.independentFormsFrom(rc).map((e) => e.mapping.formNumber), ["I-526E"]);
  assert.deepEqual(visaFormMappingService.independentFormsFrom(standalone).map((e) => e.mapping.formNumber), ["I-526"]);
});

test("I-130A/I-539A/DS-160/ETA-9035/I-20/I-129-H-Supplement never pass isIndependentUSCISForm", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(VisaFormMapping, "find", mockFind);
  const nonIndependent = FAKE_DB.filter((r) => [
    "I-130A", "I-539A", "DS-160", "ETA-9035", "I-20",
    "I-129 H Classification Supplement", "I-129 O/P Classification Supplement",
    "H-1B Data Collection and Filing Fee Exemption Supplement",
  ].includes(r.formNumber));
  assert.ok(nonIndependent.length > 0);
  for (const mapping of nonIndependent) {
    assert.equal(visaFormMappingService.isIndependentUSCISForm(mapping), false, `${mapping.formNumber} must not be independent`);
  }
});

test("independentFormsFrom dedups by formNumber even if the same form appears in two buckets", () => {
  const mapping = { formNumber: "I-129", agency: "USCIS", componentType: "STANDALONE_FORM", parentForm: null };
  const resolved = {
    autoCreate: [{ mapping }],
    conditional: [{ mapping }],
    laterStage: [],
    reference: [],
  };
  const independent = visaFormMappingService.independentFormsFrom(resolved);
  assert.equal(independent.length, 1);
});

test("isIndependentUSCISForm rejects a STANDALONE_FORM row that still has parentForm set (defensive tagging guard)", () => {
  const mistagged = { agency: "USCIS", componentType: "STANDALONE_FORM", parentForm: "I-129" };
  assert.equal(visaFormMappingService.isIndependentUSCISForm(mistagged), false);
});
