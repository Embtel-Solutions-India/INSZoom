// Phase 2 regression test (spec Rule 18/19 Test A): proves the real,
// live-until-this-phase I-130 autofill bug is actually fixed - a case using
// the i130_ir1_petitioner_checklist/i130_ir1_beneficiary_checklist key
// style (the checklist the registry ACTUALLY assigns for IR1/CR1/CR2/F1-4
// family-petition categories, distinct from k3's "_info_" key style)
// reaches the real I-130 CaseForm via the real AutoFillService.generate
// pipeline - not raw.questionnaireAnswers.* key matching, which is exactly
// what was broken before this phase (see canonicalPathFixes.seed.js and
// scripts/fix-i130-mapping-graph.js for the fix itself).
//
// Reuses the real production services directly (Case.create,
// questionnaireService.saveAnswers, AutoFillService.generate,
// MappingResolver.resolvePath) - the same pattern goldenHarness.js /
// i130-k3-golden-case.test.js already use for K-3, just without the full
// PDF-byte round trip (that binary-level correctness is already proven for
// this exact form/pipeline by i130-k3-golden-case.test.js; this test's job
// is only to prove the IR1 checklist key style now reaches the same
// CaseForm.filledData structure PDFGenerationService reads from, which the
// K-3 test already proves gets embedded into the real PDF correctly).
const assert = require("node:assert/strict");
const test = require("node:test");

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const Questionnaire = require("../../../models/Questionnaire");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const AutoFillService = require("../services/AutoFillService");
const MappingResolver = require("../services/MappingResolver");

const req = { ip: "127.0.0.1", headers: {}, get: () => undefined };

const IR1 = {
  petitioner: { lastName: "Nguyen", firstName: "Daniel", middleName: "T", dateOfBirth: "1978-04-11", gender: "Male", maritalStatus: "married", ssn: "123-45-6789", alienNumber: "A987654321" },
  beneficiary: { lastName: "Tran", firstName: "Mai", middleName: "L", dateOfBirth: "1985-09-22", maritalStatus: "married", alienNumber: "A123456789" },
};

test("Phase 2 fix: a real i130_ir1_petitioner_checklist/i130_ir1_beneficiary_checklist answer reaches I-130's CaseForm.filledData via canonical routing", async (t) => {
  const ids = { caseId: null, userIds: [] };
  t.after(async () => {
    if (ids.caseId) await Case.deleteOne({ _id: ids.caseId });
    if (ids.userIds.length) await User.deleteMany({ _id: { $in: ids.userIds } });
    await disconnectTestDB();
  });
  await connectTestDB();

  const ns = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const petitionerUser = await User.create({ email: `ir1-petitioner.${ns}@example.com`, password: "not-a-real-hash", name: `${IR1.petitioner.firstName} ${IR1.petitioner.lastName}`, role: "client" });
  ids.userIds.push(petitionerUser._id);
  const beneficiaryUser = await User.create({ email: `ir1-beneficiary.${ns}@example.com`, password: "not-a-real-hash", name: `${IR1.beneficiary.firstName} ${IR1.beneficiary.lastName}`, role: "beneficiary" });
  ids.userIds.push(beneficiaryUser._id);

  const caseDoc = await Case.create({
    caseNumber: `IR1-PHASE2-${ns}`,
    visaType: "IR-1",
    caseType: "family",
    petitionerUser: petitionerUser._id,
    beneficiaryUser: beneficiaryUser._id,
    user: petitionerUser._id,
    status: "active",
  });
  ids.caseId = caseDoc._id;

  const petitionerQ = await Questionnaire.findOne({ key: "i130_ir1_petitioner_checklist", latestVersion: true });
  const beneficiaryQ = await Questionnaire.findOne({ key: "i130_ir1_beneficiary_checklist", latestVersion: true });
  assert.ok(petitionerQ && beneficiaryQ, "sanity: both i130_ir1_* checklists must exist in the registry");

  await questionnaireService.saveAnswers(
    {
      questionnaireId: petitionerQ._id,
      caseId: caseDoc._id,
      answers: [
        { questionKey: "petitioner_lastName", value: IR1.petitioner.lastName },
        { questionKey: "petitioner_firstName", value: IR1.petitioner.firstName },
        { questionKey: "petitioner_middleName", value: IR1.petitioner.middleName },
        { questionKey: "petitioner_dateOfBirth", value: IR1.petitioner.dateOfBirth },
        { questionKey: "petitioner_gender", value: IR1.petitioner.gender },
        { questionKey: "petitioner_maritalStatus", value: IR1.petitioner.maritalStatus },
        { questionKey: "petitioner_ssn", value: IR1.petitioner.ssn },
        { questionKey: "petitioner_alienNumber", value: IR1.petitioner.alienNumber },
      ],
    },
    { _id: petitionerUser._id, role: "client" },
    req,
    "submitted"
  );
  await questionnaireService.saveAnswers(
    {
      questionnaireId: beneficiaryQ._id,
      caseId: caseDoc._id,
      answers: [
        { questionKey: "beneficiary_lastName", value: IR1.beneficiary.lastName },
        { questionKey: "beneficiary_firstName", value: IR1.beneficiary.firstName },
        { questionKey: "beneficiary_middleName", value: IR1.beneficiary.middleName },
        { questionKey: "beneficiary_dateOfBirth", value: IR1.beneficiary.dateOfBirth },
        { questionKey: "beneficiary_maritalStatus", value: IR1.beneficiary.maritalStatus },
        { questionKey: "beneficiary_alienNumber", value: IR1.beneficiary.alienNumber },
      ],
    },
    { _id: beneficiaryUser._id, role: "beneficiary" },
    req,
    "submitted"
  );

  const { caseForm } = await AutoFillService.generate(caseDoc._id, "I-130", { _id: petitionerUser._id, role: "client" }, req);

  const at = (fieldId) => MappingResolver.resolvePath(caseForm.filledData, fieldId) ?? caseForm.fieldValues?.[fieldId];

  assert.equal(at("part2.form10Subform0Part2Line4AFamilyName0"), IR1.petitioner.lastName, "petitioner family name must reach the CaseForm via the IR1 checklist key style");
  assert.equal(at("part2.form10Subform0Part2Line4BGivenName0"), IR1.petitioner.firstName, "petitioner given name must reach the CaseForm via the IR1 checklist key style");
  assert.equal(at("part2.form10Subform0Part2Line11Ssn0"), IR1.petitioner.ssn.replace(/[^0-9]/g, ""), "petitioner SSN must reach the CaseForm via the IR1 checklist key style");
  assert.equal(at("part4.form10Subform4Part4Line4AFamilyName0"), IR1.beneficiary.lastName, "beneficiary family name must reach the CaseForm via the IR1 checklist key style");
  assert.equal(at("part4.form10Subform4Part4Line4BGivenName0"), IR1.beneficiary.firstName, "beneficiary given name must reach the CaseForm via the IR1 checklist key style");
  assert.equal(at("part4.form10Subform4Area6Part4Line1AlienNumber0"), IR1.beneficiary.alienNumber.replace(/[^0-9]/g, ""), "beneficiary A-Number must reach the CaseForm via the IR1 checklist key style");
});
