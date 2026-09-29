// Live acceptance coverage for VisaFormMapping.checklistMappings (the
// checklist-mapping extension to the existing registry - see
// seeds/checklistMappings.seed.js for the data and
// visaFormMapping.service.js's resolveChecklistsForCase for the resolver).
// Against the real seeded database, not mocks - same convention as
// visaFormMapping.test.js.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const visaFormMappingService = require("../visaFormMapping.service");

async function makeCase(fields) {
  return Case.create({ caseNumber: `TEST-CKM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...fields });
}

function keys(list) {
  return list.map((entry) => entry.checklistKey);
}

test("Agency exclusion: no DOS/DOL form ever carries a checklist mapping", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const rows = await VisaFormMapping.find({ formNumber: { $in: ["DS-117", "DS-160", "DS-260", "DS-156E", "ETA-9035"] } });
  assert.ok(rows.length > 0, "sanity: these forms exist in the registry");
  rows.forEach((row) => {
    assert.equal(row.checklistMappings.length, 0, `${row.visaType}/${row.formNumber} (${row.agency}) must never carry a checklist mapping`);
  });
});

test("Component/supplement exclusion: I-129 supplements, I-130A, I-864A never get their own checklist mapping", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const rows = await VisaFormMapping.find({
    formNumber: {
      $in: [
        "I-129 H Classification Supplement", "I-129 L Classification Supplement", "I-129 O/P Classification Supplement",
        "I-129 Q Classification Supplement", "I-129 R Classification Supplement", "I-129 E Classification Supplement",
        "I-130A", "I-864A",
      ],
    },
  });
  assert.ok(rows.length > 0, "sanity: these components/supplements exist in the registry");
  rows.forEach((row) => {
    assert.equal(row.checklistMappings.length, 0, `${row.visaType}/${row.formNumber} is a component/supplement and must not have a standalone checklist mapping`);
  });
});

test("H-1B: I-129 gets employer+employee AUTO, I-539 employee-only CONDITIONAL, I-907 both CONDITIONAL", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const i129 = await VisaFormMapping.findOne({ visaType: "H-1B", formNumber: "I-129" });
  assert.deepEqual(keys(i129.checklistMappings).sort(), ["h1b_employee_checklist", "h1b_employer_checklist"]);
  assert.ok(i129.checklistMappings.every((entry) => entry.assignmentType === "AUTO"));

  const i539 = await VisaFormMapping.findOne({ visaType: "H-1B", formNumber: "I-539" });
  assert.deepEqual(keys(i539.checklistMappings), ["h1b_employee_checklist"]);
  assert.equal(i539.checklistMappings[0].assignmentType, "CONDITIONAL");

  const i907 = await VisaFormMapping.findOne({ visaType: "H-1B", formNumber: "I-907" });
  assert.deepEqual(keys(i907.checklistMappings).sort(), ["h1b_employee_checklist", "h1b_employer_checklist"]);
  assert.ok(i907.checklistMappings.every((entry) => entry.assignmentType === "CONDITIONAL"));

  const g28 = await VisaFormMapping.findOne({ visaType: "H-1B", formNumber: "G-28" });
  assert.equal(g28.checklistMappings.length, 0, "G-28 has no client checklist");
});

test("L-1A business plan checklist is CONDITIONAL on New Office petition, never AUTO for every case", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const i129 = await VisaFormMapping.findOne({ visaType: "L-1A", formNumber: "I-129" });
  const businessPlan = i129.checklistMappings.find((entry) => entry.checklistKey === "l1a_business_plan_checklist");
  assert.ok(businessPlan, "l1a_business_plan_checklist must be present on I-129");
  assert.equal(businessPlan.assignmentType, "CONDITIONAL");
  assert.equal(businessPlan.condition.field, "newOfficePetition");

  const notNewOffice = await makeCase({ visaType: "L-1A", processingPath: "PETITION_ONLY" });
  const resolvedNo = await visaFormMappingService.resolveChecklistsForCase(notNewOffice);
  assert.ok(!keys(resolvedNo.auto).includes("l1a_business_plan_checklist"), "must not auto-assign without New Office petition");

  const newOffice = await makeCase({ visaType: "L-1A", processingPath: "PETITION_ONLY", assessmentAnswers: { newOfficePetition: "yes" } });
  const resolvedYes = await visaFormMappingService.resolveChecklistsForCase(newOffice);
  assert.ok(keys(resolvedYes.auto).includes("l1a_business_plan_checklist"), "must auto-assign once New Office petition is true");

  await Case.deleteMany({ _id: { $in: [notNewOffice._id, newOffice._id] } });
});

test("H-4: Extension / EAD / Extension+EAD each map to the correct forms and questionnaire, never cross-contaminating", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const ext = await VisaFormMapping.findOne({ visaType: "H4EXTENSION", formNumber: "I-539" });
  assert.deepEqual(keys(ext.checklistMappings), ["h4_extension_questionnaire"]);
  const extA = await VisaFormMapping.findOne({ visaType: "H4EXTENSION", formNumber: "I-539A" });
  assert.deepEqual(keys(extA.checklistMappings), ["h4_extension_questionnaire"]);
  const extI765 = await VisaFormMapping.findOne({ visaType: "H4EXTENSION", formNumber: "I-765" });
  assert.ok(!extI765 || extI765.checklistMappings.length === 0, "H-4 Extension must not map I-765");

  const ead = await VisaFormMapping.findOne({ visaType: "H4EAD", formNumber: "I-765" });
  assert.deepEqual(keys(ead.checklistMappings), ["h4_ead_questionnaire"]);
  const eadI539 = await VisaFormMapping.findOne({ visaType: "H4EAD", formNumber: "I-539" });
  assert.ok(!eadI539 || eadI539.checklistMappings.length === 0, "H-4 EAD must not map I-539");

  const extEadI539 = await VisaFormMapping.findOne({ visaType: "H4EXTENSIONEAD", formNumber: "I-539" });
  const extEadI765 = await VisaFormMapping.findOne({ visaType: "H4EXTENSIONEAD", formNumber: "I-765" });
  assert.deepEqual(keys(extEadI539.checklistMappings), ["h4_extension_ead_questionnaire"]);
  assert.deepEqual(keys(extEadI765.checklistMappings), ["h4_extension_ead_questionnaire"]);
});

test("Family: Petition Only assigns I-130 petitioner+beneficiary; AOS additionally resolves green-card/I-864 checklists", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const petitionOnly = await makeCase({ visaType: "IR-1", processingPath: "PETITION_ONLY" });
  const resolvedPetitionOnly = await visaFormMappingService.resolveChecklistsForCase(petitionOnly);
  assert.ok(keys(resolvedPetitionOnly.auto).includes("i130_ir1_petitioner_checklist"));
  assert.ok(keys(resolvedPetitionOnly.auto).includes("i130_ir1_beneficiary_checklist"));

  const aos = await makeCase({ visaType: "IR-1", processingPath: "ADJUSTMENT_OF_STATUS" });
  const resolvedAos = await visaFormMappingService.resolveChecklistsForCase(aos);
  assert.ok(keys(resolvedAos.auto).includes("i130_ir1_petitioner_checklist"));
  assert.ok(keys(resolvedAos.auto).includes("green_card_ir1_beneficiary_checklist"));
  assert.ok(keys(resolvedAos.auto).includes("i864_ir1_petitioner_checklist"));

  await Case.deleteMany({ _id: { $in: [petitionOnly._id, aos._id] } });
});

test("Family: joint sponsor checklist only activates once a joint sponsor is actually present on the case", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const noSponsor = await makeCase({ visaType: "CR-1", processingPath: "CONSULAR" });
  const resolvedNo = await visaFormMappingService.resolveChecklistsForCase(noSponsor);
  assert.ok(!keys(resolvedNo.auto).includes("i864_cr1_joint_sponsor_checklist"));

  const withSponsor = await makeCase({ visaType: "CR-1", processingPath: "CONSULAR", jointSponsorUser: new mongoose.Types.ObjectId() });
  const resolvedYes = await visaFormMappingService.resolveChecklistsForCase(withSponsor);
  assert.ok(keys(resolvedYes.auto).includes("i864_cr1_joint_sponsor_checklist"));

  await Case.deleteMany({ _id: { $in: [noSponsor._id, withSponsor._id] } });
});

test("Family: GC-NVC checklist is EXPLICIT_CM - never auto-assigned solely because the processing path is CONSULAR", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const consular = await makeCase({ visaType: "CR-1", processingPath: "CONSULAR" });
  const resolved = await visaFormMappingService.resolveChecklistsForCase(consular);
  assert.ok(!keys(resolved.auto).includes("gc_nvc_cr1_beneficiary_checklist"), "must never be in the auto-assign bucket");
  assert.ok(keys(resolved.explicitCm).includes("gc_nvc_cr1_beneficiary_checklist"), "must be surfaced as an explicit case-manager action");
  await Case.deleteOne({ _id: consular._id });
});

test("Change of Status: F-1/F-2/B-1/B-2 each resolve to their own questionnaire; F-1 -> B-2 shares cos_b2_questionnaire", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const f1 = await VisaFormMapping.findOne({ visaType: "COSF1", formNumber: "I-539" });
  const f2 = await VisaFormMapping.findOne({ visaType: "COSF2", formNumber: "I-539" });
  const b1 = await VisaFormMapping.findOne({ visaType: "COSB1", formNumber: "I-539" });
  const b2 = await VisaFormMapping.findOne({ visaType: "COSB2", formNumber: "I-539" });
  const f1ToB2 = await VisaFormMapping.findOne({ visaType: "B-1/B-2", formNumber: "I-539" });
  assert.deepEqual(keys(f1.checklistMappings), ["cos_f1_questionnaire"]);
  assert.deepEqual(keys(f2.checklistMappings), ["cos_f2_questionnaire"]);
  assert.deepEqual(keys(b1.checklistMappings), ["cos_b1_questionnaire"]);
  assert.deepEqual(keys(b2.checklistMappings), ["cos_b2_questionnaire"]);
  assert.deepEqual(keys(f1ToB2.checklistMappings), ["cos_b2_questionnaire"], "F-1 -> B-2 must share cos_b2_questionnaire, never a separate checklist");
});

test("Gaps: L-1B, O-2, EB-5 never silently receive an unrelated checklist", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const l1b = await VisaFormMapping.find({ visaType: "L-1B" });
  const o2 = await VisaFormMapping.find({ visaType: "O-2" });
  const eb5a = await VisaFormMapping.find({ visaType: "EB-5 Regional Center" });
  const eb5b = await VisaFormMapping.find({ visaType: "EB-5 Standalone" });
  ;[...l1b, ...o2, ...eb5a, ...eb5b].forEach((row) => {
    assert.equal(row.checklistMappings.length, 0, `${row.visaType}/${row.formNumber} is a known GAP and must not carry any checklist`);
  });
});

test("Scaffold: cos_generic/f1_reinstatement/ead_i765 questionnaires are never attached to a VisaFormMapping row by this seed", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const rows = await VisaFormMapping.find({ "checklistMappings.checklistKey": { $in: ["cos_generic_questionnaire", "f1_reinstatement_questionnaire", "ead_i765_questionnaire"] } });
  assert.equal(rows.length, 0, "scaffold-only questionnaires must not be wired into the registry as if production-ready");
});
