// L-1A Extension e2e (needs the test DB): a case of this type is assigned the same USCIS forms as an L-1A case, and the real I-129
// autofill prints "L-1A" and ticks the L-1A box plus "Continuation of previously approved employment". A plain L-1A case prints/ticks
// L-1A only. Neither prints the words "L-1A Extension". Questionnaire answers are not needed: these boxes come from the case type.
const assert = require("node:assert/strict");
const test = require("node:test");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");

const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const User = require("../../../models/User");
const Beneficiary = require("../../../models/Beneficiary");
const Company = require("../../../models/Company");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const MappingResolver = require("../../form-mapping/services/MappingResolver");

const STAMP = Date.now();
const created = { users: [], beneficiaries: [], companies: [], cases: [] };
const req = { ip: "127.0.0.1", headers: {} };

async function makeCase(visaType, suffix) {
  const user = await User.create({ email: `l1a-ext-${suffix}-${STAMP}@example.com`, password: "not-a-real-hash", name: `Ext Tester ${suffix}`, role: "client" });
  created.users.push(user._id);
  const beneficiary = await Beneficiary.create({ user: user._id, firstName: "Extie", lastName: `Tester${suffix}`, dateOfBirth: new Date("1985-03-02") });
  created.beneficiaries.push(beneficiary._id);
  const company = await Company.create({ name: `Ext Co ${suffix} ${STAMP}`, ein: "12-3456789" });
  created.companies.push(company._id);
  const caseDoc = await Case.create({ caseNumber: `L1AEXT-${suffix}-${STAMP}`, visaType, user: user._id, beneficiary: beneficiary._id, companyId: company._id, status: "active" });
  created.cases.push(caseDoc._id);
  await uscisFormService.ensureAssignedForms(caseDoc, { _id: user._id, role: "team_lead" }, req);
  return { user, caseDoc };
}

async function printI129({ user, caseDoc }) {
  const { caseForm } = await AutoFillService.generate(caseDoc._id, "I-129", { _id: user._id, role: "client" }, req);
  const template = await USCISFormTemplate.findById(caseForm.formTemplateId).lean();
  const ids = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
  return (fieldName) => MappingResolver.resolvePath(caseForm.filledData, ids.get(fieldName));
}

test.before(async () => { await connectTestDB(); });
test.after(async () => {
  if (created.cases.length) await CaseForm.deleteMany({ caseId: { $in: created.cases } });
  await Case.deleteMany({ _id: { $in: created.cases } });
  await Beneficiary.deleteMany({ _id: { $in: created.beneficiaries } });
  await Company.deleteMany({ _id: { $in: created.companies } });
  await User.deleteMany({ _id: { $in: created.users } });
  await disconnectTestDB();
});

test("L-1A Extension: same forms as L-1A; I-129 prints L-1A, ticks L-1A + Continuation; plain L-1A ticks L-1A only", async () => {
  const ext = await makeCase("L-1A Extension", "x");
  const plain = await makeCase("L-1A", "p");

  const formCodes = async (c) => (await CaseForm.find({ caseId: c.caseDoc._id }).select("formCode").lean()).map((f) => f.formCode).sort();
  assert.ok((await formCodes(ext)).includes("I-129"), "an I-129 CaseForm is created for an L-1A Extension case");
  assert.deepEqual(await formCodes(ext), await formCodes(plain), "same USCIS forms as L-1A");

  const extGet = await printI129(ext);
  assert.equal(extGet("form1[0].#subform[1].Part2_ClassificationSymbol[0]"), "L-1A");
  assert.equal(extGet("form1[0].#subform[25].a_L1A[0]"), true);
  assert.notEqual(extGet("form1[0].#subform[25].b_L1B[0]"), true);
  assert.equal(extGet("form1[0].#subform[1].continuation[0]"), true);

  const plainGet = await printI129(plain);
  assert.equal(plainGet("form1[0].#subform[1].Part2_ClassificationSymbol[0]"), "L-1A");
  assert.equal(plainGet("form1[0].#subform[25].a_L1A[0]"), true);
  assert.notEqual(plainGet("form1[0].#subform[1].continuation[0]"), true, "a plain L-1A case never ticks Continuation");
});
