// End to end: real checklist answers -> canonical profile -> a form the Case Manager ADDED by name -> correct field values, for a case of the form's own
// visa family and for a case of an unrelated visa type. Local isolated test database only (test-utils/db.js); only this file's own data is removed.
const test = require("node:test");
process.env.PARTY_CHECKLIST_PATHS = "on"; // the generic-path definitions are opt-in (see questionnaire.service.js)
const assert = require("node:assert/strict");
const path = require("path");

if (!process.env.LOCAL_STORAGE_PATH) process.env.LOCAL_STORAGE_PATH = path.resolve(__dirname, "..", "..", "..", "..", "storage");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const CaseFormSelection = require("../../../models/CaseFormSelection");
const User = require("../../../models/User");
const Questionnaire = require("../../../models/Questionnaire");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const manager = require("../case-form-selection-manager.service");
const MappingResolver = require("../../form-mapping/services/MappingResolver");

const req = { ip: "127.0.0.1", headers: {}, get: () => undefined };
const P = { lastName: "Nguyen", firstName: "Daniel", middleName: "T", dateOfBirth: "1978-04-11", gender: "Male", maritalStatus: "married", ssn: "123-45-6789", alienNumber: "A987654321" };
const B = { lastName: "Tran", firstName: "Mai", middleName: "L", dateOfBirth: "1985-09-22", maritalStatus: "married", alienNumber: "A123456789" };

const made = { caseIds: [], userIds: [] };
async function cleanup() {
  await CaseForm.deleteMany({ caseId: { $in: made.caseIds } });
  await CaseFormSelection.deleteMany({ caseId: { $in: made.caseIds } });
  await Case.deleteMany({ _id: { $in: made.caseIds } });
  await User.deleteMany({ _id: { $in: made.userIds } });
}

async function scenario(t, { visaType, caseType }) {
  const ns = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const petitioner = await User.create({ email: `e2e-p.${ns}@example.com`, password: "not-a-real-hash", name: `${P.firstName} ${P.lastName}`, role: "client" });
  const beneficiary = await User.create({ email: `e2e-b.${ns}@example.com`, password: "not-a-real-hash", name: `${B.firstName} ${B.lastName}`, role: "beneficiary" });
  made.userIds.push(petitioner._id, beneficiary._id);
  const caseDoc = await Case.create({ caseNumber: `E2E-${visaType}-${ns}`, visaType, caseType, petitionerUser: petitioner._id, beneficiaryUser: beneficiary._id, user: petitioner._id, status: "active", checklistApproval: { required: false } });
  made.caseIds.push(caseDoc._id);

  const petitionerQ = await Questionnaire.findOne({ key: "i130_ir1_petitioner_checklist", latestVersion: true });
  const beneficiaryQ = await Questionnaire.findOne({ key: "i130_ir1_beneficiary_checklist", latestVersion: true });
  assert.ok(petitionerQ && beneficiaryQ, "the I-130 checklists exist");
  const answer = (questionKey, value) => ({ questionKey, value });
  await questionnaireService.saveAnswers({ questionnaireId: petitionerQ._id, caseId: caseDoc._id, answers: [
    answer("petitioner_lastName", P.lastName), answer("petitioner_firstName", P.firstName), answer("petitioner_middleName", P.middleName), answer("petitioner_dateOfBirth", P.dateOfBirth),
    answer("petitioner_gender", P.gender), answer("petitioner_maritalStatus", P.maritalStatus), answer("petitioner_ssn", P.ssn), answer("petitioner_alienNumber", P.alienNumber),
  ] }, { _id: petitioner._id, role: "client" }, req, "submitted");
  await questionnaireService.saveAnswers({ questionnaireId: beneficiaryQ._id, caseId: caseDoc._id, answers: [
    answer("beneficiary_lastName", B.lastName), answer("beneficiary_firstName", B.firstName), answer("beneficiary_middleName", B.middleName), answer("beneficiary_dateOfBirth", B.dateOfBirth),
    answer("beneficiary_maritalStatus", B.maritalStatus), answer("beneficiary_alienNumber", B.alienNumber),
  ] }, { _id: beneficiary._id, role: "beneficiary" }, req, "submitted");

  const staff = { _id: new (require("mongoose").Types.ObjectId)(), role: "super_admin" };
  const added = await manager.updateSelection(caseDoc._id, { expectedRevision: 0, add: [{ name: "I-130" }], autofill: true }, staff, req);
  return { caseDoc, added, staff };
}

const valueAt = (form, fieldId) => MappingResolver.resolvePath(form.filledData, fieldId) ?? form.fieldValues?.[fieldId];

for (const { visaType, caseType, label } of [
  { visaType: "IR-1", caseType: "family", label: "the form's own visa family" },
  { visaType: "H-1B", caseType: "employment", label: "an unrelated visa type" },
]) {
  test(`E2E: I-130 added by name to a ${visaType} case (${label}) is created and filled from the case's checklist answers`, async (t) => {
    t.after(async () => { await cleanup(); await disconnectTestDB(); });
    await connectTestDB();
    const { caseDoc, added } = await scenario(t, { visaType, caseType });
    assert.equal(added.results[0].status, "ok", JSON.stringify(added.results));
    assert.equal(added.autofill[0]?.status, "filled", JSON.stringify(added.autofill));
    const form = await CaseForm.findOne({ caseId: caseDoc._id, formCode: "I-130" }).lean();
    assert.ok(form, "the CaseForm exists");
    assert.equal(form.status, "ai_filled");
    assert.equal(valueAt(form, "part2.form10Subform0Part2Line4AFamilyName0"), P.lastName, "petitioner family name");
    assert.equal(valueAt(form, "part2.form10Subform0Part2Line4BGivenName0"), P.firstName, "petitioner given name");
    assert.equal(valueAt(form, "part2.form10Subform0Part2Line11Ssn0"), P.ssn.replace(/[^0-9]/g, ""), "petitioner SSN");
    assert.equal(valueAt(form, "part4.form10Subform4Part4Line4AFamilyName0"), B.lastName, "beneficiary family name");
    assert.equal(valueAt(form, "part4.form10Subform4Part4Line4BGivenName0"), B.firstName, "beneficiary given name");
    assert.equal(valueAt(form, "part4.form10Subform4Area6Part4Line1AlienNumber0"), B.alienNumber.replace(/[^0-9]/g, ""), "beneficiary A-Number");
    // the readiness report says what is filled and what still needs someone
    const summary = form.autoFillReport?.summary;
    assert.ok(summary, "the auto-fill report carries a readiness summary");
    assert.ok(summary.populated >= 6);
    assert.ok(["complete", "needs_attention"].includes(summary.status));
    t.diagnostic(`${visaType}: ${JSON.stringify({ populated: summary.populated, needsClientInformation: summary.needsClientInformation, needsStaffInput: summary.needsStaffInput, unmapped: summary.unmapped, status: summary.status })}`);
  });
}
