// Live acceptance coverage for the VisaFormMapping registry - positive AND
// negative assertions per the plan's corrections §15, against a real
// seeded database, not mocks. Reuses buildGoldenH1bCase for the H-1B
// scenarios (real imported I-129/I-539/I-539A/I-907 templates); other
// scenarios construct a lightweight real Case document directly since no
// golden fixture exists for EB-5/F-1/I-751/N-400/etc, and most of those
// AUTO_CREATE mappings correctly have no imported USCISFormTemplate in
// this system yet (TEMPLATE_MISSING is the expected, correct result).
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const visaFormMappingService = require("../visaFormMapping.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

async function makeCase(fields) {
  return Case.create({ caseNumber: `TEST-VFM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...fields });
}

function formNumbers(entries) {
  return entries.map((e) => e.mapping.formNumber);
}

test("H-1B CONSULAR: positive/negative registry applicability", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "H-1B", processingPath: "CONSULAR", premiumProcessing: false });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const autoCreateForms = formNumbers(resolved.autoCreate);
    const conditionalForms = formNumbers(resolved.conditional);

    assert.ok(autoCreateForms.includes("I-129"), "EXPECTED: I-129 auto-create");
    assert.ok(autoCreateForms.includes("I-129 H Classification Supplement"), "EXPECTED: H classification supplement auto-create");
    assert.ok(autoCreateForms.includes("H-1B Data Collection and Filing Fee Exemption Supplement"), "EXPECTED: H-1B data collection supplement auto-create");
    assert.ok(autoCreateForms.includes("ETA-9035"), "EXPECTED: ETA-9035 LCA auto-create");
    assert.ok(conditionalForms.includes("DS-160"), "EXPECTED: DS-160 CONDITIONAL, applicable and offered for CONSULAR processing path (per spec §6, H-1B's DS-160 is CONDITIONAL, not AUTO_CREATE)");

    assert.ok(!autoCreateForms.includes("DS-160"), "FORBIDDEN: DS-160 must not be auto-create for H-1B");
    assert.ok(!autoCreateForms.includes("I-907"), "FORBIDDEN: I-907 must not be auto-create");
    assert.ok(!autoCreateForms.includes("I-539"), "FORBIDDEN: I-539 must not be auto-create");
    assert.ok(conditionalForms.includes("I-907"), "EXPECTED: I-907 offered as conditional");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("H-1B CHANGE_OF_STATUS: DS-160 not applicable for this path, I-907 offered as conditional (never auto)", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "H-1B", processingPath: "CHANGE_OF_STATUS" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const autoCreateForms = formNumbers(resolved.autoCreate);
    const conditionalForms = formNumbers(resolved.conditional);

    assert.ok(autoCreateForms.includes("I-129"), "EXPECTED: I-129 auto-create regardless of processing path");
    assert.ok(!autoCreateForms.includes("DS-160"), "FORBIDDEN: DS-160 must not be applicable for a pure COS case - the H-1B DS-160 mapping is CONSULAR-only");
    assert.ok(!conditionalForms.includes("DS-160"), "FORBIDDEN: DS-160 must not even be offered as conditional for a pure COS case - it's gated out entirely, not merely un-auto-created");
    assert.ok(conditionalForms.includes("I-907"), "EXPECTED: I-907 is always offered as a Case Manager decision, regardless of processing path");
    assert.ok(!autoCreateForms.includes("I-907"), "FORBIDDEN: I-907 must never be auto-create - it's CONDITIONAL by design");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("L-1A CONSULAR: I-129 + L supplement auto-create, DS-160/I-129S/I-907 conditional", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "L-1A", processingPath: "CONSULAR" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const autoCreateForms = formNumbers(resolved.autoCreate);
    const conditionalForms = formNumbers(resolved.conditional);
    assert.ok(autoCreateForms.includes("I-129"));
    assert.ok(autoCreateForms.includes("I-129 L Classification Supplement"));
    assert.ok(conditionalForms.includes("DS-160"), "EXPECTED: L-1A's DS-160 mapping is CONDITIONAL per spec, offered for the CONSULAR path");
    assert.ok(!autoCreateForms.includes("DS-160"), "FORBIDDEN: DS-160 must not be auto-create for L-1A");
    assert.ok(conditionalForms.includes("I-129S"), "EXPECTED: blanket L petition offered as conditional");
    assert.ok(conditionalForms.includes("I-907"));
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("EB-2 NIW ADJUSTMENT_OF_STATUS: I-140 auto-create, DS-260 FORBIDDEN (AOS not consular)", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "EB-2 NIW", processingPath: "ADJUSTMENT_OF_STATUS" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const autoCreateForms = formNumbers(resolved.autoCreate);
    const conditionalForms = formNumbers(resolved.conditional);
    assert.ok(autoCreateForms.includes("I-140"), "EXPECTED: I-140 auto-create");
    assert.ok(!autoCreateForms.includes("DS-260"), "FORBIDDEN: DS-260 must not be applicable for an AOS case");
    assert.ok(!conditionalForms.includes("DS-260"), "FORBIDDEN: DS-260 mapping is gated to CONSULAR/NVC processing paths only - not applicable at all for AOS");
    assert.ok(conditionalForms.includes("I-485"), "EXPECTED: I-485 conditional for AOS path");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("EB-2 CONSULAR: DS-260 conditional (immigrant-visa stage), I-485 FORBIDDEN for pure consular case", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "EB-2 PERM", processingPath: "CONSULAR" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const laterStageForms = formNumbers(resolved.laterStage);
    assert.ok(laterStageForms.includes("I-140"), "EXPECTED: I-140 is LATER_STAGE for PERM-based EB-2");
    assert.ok(laterStageForms.includes("DS-260"), "EXPECTED: DS-260 available at the immigrant-visa stage");
    assert.ok(!formNumbers(resolved.autoCreate).includes("I-485"), "FORBIDDEN: I-485 must not auto-create for a pure consular case");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("EB-5 Regional Center vs Standalone: I-526E/I-526 are never substituted for each other", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const rc = await makeCase({ visaType: "EB-5 Regional Center" });
  const standalone = await makeCase({ visaType: "EB-5 Standalone" });
  try {
    const rcResolved = await visaFormMappingService.resolveApplicableMappings(rc);
    const standaloneResolved = await visaFormMappingService.resolveApplicableMappings(standalone);
    assert.ok(formNumbers(rcResolved.autoCreate).includes("I-526E"), "EXPECTED: Regional Center -> I-526E");
    assert.ok(!formNumbers(rcResolved.autoCreate).includes("I-526"), "FORBIDDEN: Regional Center must not also get I-526");
    assert.ok(formNumbers(standaloneResolved.autoCreate).includes("I-526"), "EXPECTED: Standalone -> I-526");
    assert.ok(!formNumbers(standaloneResolved.autoCreate).includes("I-526E"), "FORBIDDEN: Standalone must not also get I-526E");
  } finally {
    await Case.deleteMany({ _id: { $in: [rc._id, standalone._id] } });
  }
});

test("F-1 STEM OPT: I-765 auto-create (real EAD application), I-983 present but never conflated with I-765", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "F-1 STEM OPT" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const autoCreateEntries = resolved.autoCreate;
    const i765Entry = autoCreateEntries.find((e) => e.mapping.formNumber === "I-765");
    const i983Entry = autoCreateEntries.find((e) => e.mapping.formNumber === "I-983");
    assert.ok(i765Entry, "EXPECTED: I-765 present and auto-create");
    assert.equal(i765Entry.mapping.agency, "USCIS");
    assert.ok(i983Entry, "EXPECTED: I-983 present as its own registry entry");
    assert.equal(i983Entry.mapping.agency, "SEVP", "I-983 must be tagged SEVP, never USCIS - it is not the EAD application");
    assert.notEqual(i765Entry.mapping._id.toString(), i983Entry.mapping._id.toString(), "FORBIDDEN: I-983 must never be the same mapping record as I-765");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("SB-1: DS-117 auto-create", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "SB-1" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    assert.ok(formNumbers(resolved.autoCreate).includes("DS-117"), "EXPECTED: DS-117 auto-create");
    assert.ok(formNumbers(resolved.laterStage).includes("DS-260"), "EXPECTED: DS-260 is LATER_STAGE for SB-1");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("I-751 case: I-751 auto-create, I-90 FORBIDDEN", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "Conditional Green Card Removal" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    assert.ok(formNumbers(resolved.autoCreate).includes("I-751"), "EXPECTED: I-751 auto-create");
    assert.ok(!formNumbers(resolved.autoCreate).includes("I-90"), "FORBIDDEN: I-90 must not appear for an I-751 case");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("I-90 case: I-90 auto-create, I-751 FORBIDDEN", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "Green Card Renewal" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    assert.ok(formNumbers(resolved.autoCreate).includes("I-90"), "EXPECTED: I-90 auto-create");
    assert.ok(!formNumbers(resolved.autoCreate).includes("I-751"), "FORBIDDEN: I-751 must not appear for an I-90 case");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("N-400: N-400 auto-create, N-600 FORBIDDEN", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "Naturalization" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    assert.ok(formNumbers(resolved.autoCreate).includes("N-400"), "EXPECTED: N-400 auto-create");
    assert.ok(!formNumbers(resolved.autoCreate).includes("N-600"), "FORBIDDEN: N-600 must not appear for a Naturalization case");
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("TEMPLATE_MISSING diagnostic: AUTO_CREATE mapping with no imported USCISFormTemplate is surfaced, never silently dropped or reclassified", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const caseData = await makeCase({ visaType: "EB-2 NIW", processingPath: "ADJUSTMENT_OF_STATUS" });
  try {
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const i140 = resolved.autoCreate.find((e) => e.mapping.formNumber === "I-140");
    assert.ok(i140, "I-140 must still be present in autoCreate (registry applicability, never revoked)");
    assert.ok(["TEMPLATE_AVAILABLE", "TEMPLATE_MISSING", "TEMPLATE_RULE_CONFLICT"].includes(i140.templateStatus));
    const diagnostics = visaFormMappingService.templateDiagnostics(resolved.autoCreate);
    if (i140.templateStatus !== "TEMPLATE_AVAILABLE") {
      const diag = diagnostics.find((d) => d.formNumber === "I-140");
      assert.ok(diag, "a non-available I-140 must produce a diagnostic entry, not silence");
      assert.equal(diag.reason, i140.templateStatus);
    }
  } finally {
    await Case.deleteOne({ _id: caseData._id });
  }
});

test("Idempotency: provisioning twice produces no duplicate CaseForms, and assignmentRules + registry both matching I-129 produces exactly one", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const caseData = await Case.findById(golden.caseId);
    caseData.processingPath = "CONSULAR";
    await caseData.save();

    await uscisFormService.ensureAssignedForms(caseData, golden.user, {});
    const afterFirst = await CaseForm.find({ caseId: caseData._id, formCode: "I-129" });
    assert.equal(afterFirst.length, 1, "exactly one I-129 CaseForm after first provisioning (assignmentRules + registry both matched, must not duplicate)");

    await uscisFormService.ensureAssignedForms(caseData, golden.user, {});
    const afterSecond = await CaseForm.find({ caseId: caseData._id, formCode: "I-129" });
    assert.equal(afterSecond.length, 1, "still exactly one I-129 CaseForm after re-running provisioning (idempotent)");

    const totalAfterFirst = await CaseForm.countDocuments({ caseId: caseData._id });
    await uscisFormService.ensureAssignedForms(caseData, golden.user, {});
    const totalAfterThird = await CaseForm.countDocuments({ caseId: caseData._id });
    assert.equal(totalAfterThird, totalAfterFirst, "total CaseForm count is stable across repeated provisioning calls");
  } finally {
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
  }
});

test("Conditional decision: ADD creates a CaseForm and persists the decision; a second call does not re-ask or duplicate", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const caseData = await Case.findById(golden.caseId);
    await uscisFormService.ensureAssignedForms(caseData, golden.user, {});
    const resolvedBefore = await visaFormMappingService.resolveApplicableMappings(caseData);
    const i907Mapping = resolvedBefore.conditional.find((e) => e.mapping.formNumber === "I-907");
    assert.ok(i907Mapping, "I-907 conditional mapping must be present");
    assert.equal(i907Mapping.decision, null, "no decision recorded yet - pending, not a stored PENDING record");

    const result = await visaFormMappingService.recordConditionalDecision(caseData, i907Mapping.mapping._id, "ADD", golden.user, "Client requested premium processing", {});
    assert.equal(result.decisionRecord.decision, "ADD");

    const reloaded = await Case.findById(caseData._id);
    assert.equal(reloaded.conditionalFormDecisions.length, 1);

    const resolvedAfter = await visaFormMappingService.resolveApplicableMappings(reloaded);
    const i907After = resolvedAfter.conditional.find((e) => e.mapping.formNumber === "I-907");
    assert.equal(i907After.decision, "ADD", "decision must now show ADD, never re-asked as pending");

    if (result.templateStatus === "TEMPLATE_AVAILABLE") {
      const caseForms = await CaseForm.find({ caseId: reloaded._id, formCode: "I-907" });
      assert.equal(caseForms.length, 1, "exactly one I-907 CaseForm after ADD decision");
      assert.equal(caseForms[0].provisioning?.provisioningType, "CONDITIONAL");
    }
  } finally {
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
  }
});

test("Conditional decision: NOT_APPLICABLE never creates a CaseForm and is never re-asked", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const caseData = await Case.findById(golden.caseId);
    const resolved = await visaFormMappingService.resolveApplicableMappings(caseData);
    const i907Mapping = resolved.conditional.find((e) => e.mapping.formNumber === "I-907");
    await visaFormMappingService.recordConditionalDecision(caseData, i907Mapping.mapping._id, "NOT_APPLICABLE", golden.user, "Not needed", {});

    const caseForms = await CaseForm.find({ caseId: caseData._id, formCode: "I-907" });
    assert.equal(caseForms.length, 0, "NOT_APPLICABLE must never create a CaseForm");

    const reloaded = await Case.findById(caseData._id);
    const resolvedAfter = await visaFormMappingService.resolveApplicableMappings(reloaded);
    const i907After = resolvedAfter.conditional.find((e) => e.mapping.formNumber === "I-907");
    assert.equal(i907After.decision, "NOT_APPLICABLE");
  } finally {
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
  }
});

test("Server-authoritative: client-supplied requiredForms/formsToCreate is rejected, never silently accepted", async () => {
  const { assertNoClientProvidedForms } = visaFormMappingService;
  assert.throws(() => assertNoClientProvidedForms({ decision: "ADD", requiredForms: ["I-129"] }), /may not specify/);
  assert.throws(() => assertNoClientProvidedForms({ decision: "ADD", formsToCreate: ["I-129"] }), /may not specify/);
  assert.doesNotThrow(() => assertNoClientProvidedForms({ decision: "ADD", reason: "x" }));
});

test("Whitelist enforcement: a trigger referencing a non-whitelisted field is rejected by the registry validator", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const { validateRegistry } = require("../visaFormMapping.validator");
  const bad = await VisaFormMapping.create({
    visaType: "TESTVISA-VALIDATOR", immigrationNature: "TEMPORARY_NONIMMIGRANT", formNumber: "I-999", formName: "Test",
    agency: "USCIS", provisioningType: "CONDITIONAL", componentType: "STANDALONE_FORM",
  });
  try {
    // Bypass schema validation deliberately to simulate a legacy/corrupt
    // record and confirm the validator (not just the schema) also catches it.
    await VisaFormMapping.collection.updateOne({ _id: bad._id }, { $set: { triggerCondition: { field: "someInventedField", operator: "equals", value: true } } });
    const result = await validateRegistry();
    assert.ok(!result.pass);
    assert.ok(result.errors.some((e) => e.includes("someInventedField")));
  } finally {
    await VisaFormMapping.deleteOne({ _id: bad._id });
  }
});
