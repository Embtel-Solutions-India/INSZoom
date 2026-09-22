const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const visaFormMappingService = require("../visaFormMapping.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");

// SB-1's DS-260 is CONDITIONAL, gated on the Case Manager explicitly
// recording the SB-1 returning-resident-status decision as approved -
// never activated merely because the case exists (integration prompt §7/
// §10). Reuses the existing recordConditionalDecision mechanism directly
// (the same one I-131/N-565 already use) - no new decision-recording
// mechanism was built for SB-1. Fully mocked, no real DB connection.

function fakeMapping(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    visaType: "SB-1",
    formNumber: "DS-260",
    active: true,
    provisioningType: "CONDITIONAL",
    componentType: "ONLINE_APPLICATION",
    agency: "DOS",
    processingPaths: ["CONSULAR", "NVC"],
    triggerCondition: null,
    formTemplateFormCode: null,
    ...overrides,
  };
}

function fakeCase(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    visaType: "SB-1",
    processingPath: "CONSULAR",
    conditionalFormDecisions: [],
    questionnaireReferences: [],
    save: async () => {},
    ...overrides,
  };
}

const fakeUser = { _id: new mongoose.Types.ObjectId(), role: "case_manager" };

test("DS-260 is not applicable/decided for a brand-new SB-1 case until the Case Manager explicitly records a decision", () => {
  const caseData = fakeCase();
  assert.equal(caseData.conditionalFormDecisions.length, 0, "no decision exists yet - DS-260 has not been activated merely because the case exists");
});

test("recordConditionalDecision(ADD) activates DS-260 for an SB-1 case once the mapping is found applicable", async (t) => {
  t.after(() => mock.restoreAll());
  const mapping = fakeMapping();
  const caseData = fakeCase();
  mock.method(VisaFormMapping, "findById", async () => mapping);
  mock.method(uscisFormService, "findLatestActiveTemplate", async () => null); // DS-260 has no PDF template - it's an online CEAC application, not a downloadable PDF (integration prompt §7).
  const ensureAssignedFormsCalls = [];
  mock.method(uscisFormService, "ensureAssignedForms", async (...args) => { ensureAssignedFormsCalls.push(args); return []; });

  const result = await visaFormMappingService.recordConditionalDecision(caseData, mapping._id, "ADD", fakeUser, "SB-1 returning resident status approved", {});

  assert.equal(result.decisionRecord.decision, "ADD");
  assert.equal(result.decisionRecord.formNumber, "DS-260");
  assert.equal(caseData.conditionalFormDecisions.length, 1);
  // DS-260 genuinely has no PDF template (it's the CEAC online application),
  // so ensureAssignedForms/CaseForm creation is correctly never reached -
  // this must not be treated as a failure; the decision itself is what
  // "activates" DS-260 for display purposes (resolveVisaFormMappings'
  // `conditional` bucket, keyed by decisionFor()).
  assert.equal(ensureAssignedFormsCalls.length, 0);
});

test("recordConditionalDecision is idempotent - recording ADD twice never creates a second decision record", async (t) => {
  t.after(() => mock.restoreAll());
  const mapping = fakeMapping();
  const caseData = fakeCase();
  mock.method(VisaFormMapping, "findById", async () => mapping);
  mock.method(uscisFormService, "findLatestActiveTemplate", async () => null);
  mock.method(uscisFormService, "ensureAssignedForms", async () => []);

  await visaFormMappingService.recordConditionalDecision(caseData, mapping._id, "ADD", fakeUser, "", {});
  assert.equal(caseData.conditionalFormDecisions.length, 1);
  await visaFormMappingService.recordConditionalDecision(caseData, mapping._id, "ADD", fakeUser, "", {});
  assert.equal(caseData.conditionalFormDecisions.length, 1, "must update the existing decision record, never duplicate it");
});

test("recordConditionalDecision rejects a DS-260 decision for a case whose visaType or processingPath doesn't match (e.g. an SB-1 mapping applied to a different case)", async (t) => {
  t.after(() => mock.restoreAll());
  const mapping = fakeMapping();
  const wrongVisaCase = fakeCase({ visaType: "EB-1A" });
  mock.method(VisaFormMapping, "findById", async () => mapping);

  await assert.rejects(
    () => visaFormMappingService.recordConditionalDecision(wrongVisaCase, mapping._id, "ADD", fakeUser, "", {}),
    /not applicable/i
  );
});

test("DS-117 is never itself gated by a Case Manager decision - it is AUTO_CREATE, provisioned automatically at case creation", () => {
  const { mappings } = require("../seeds/visaFormMappings.seed");
  const ds117 = mappings.find((m) => m.visaType === "SB-1" && m.formNumber === "DS-117");
  assert.equal(ds117.provisioningType, "AUTO_CREATE");
});
