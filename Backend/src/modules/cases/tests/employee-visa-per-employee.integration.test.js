// Different visas for different employees of one employer (test database): an employer matter on H-1B can add an
// H-1B, an L-1A and an L-1B employee. Each employee case carries its OWN visa/filing type and gets its own
// checklists provisioned from it, while the employer side stays a single shared record.
const assert = require("node:assert/strict");
const test = require("node:test");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const Answer = require("../../../models/Answer");
const EmployeeProfile = require("../../../models/EmployeeProfile");
const EmployerProfile = require("../../../models/EmployerProfile");
const CaseNumberService = require("../../../services/CaseNumberService");
const ctrl = require("../case.controller");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
const next = (error) => { if (error) throw error; };

async function employerMatter() {
  const stamp = Date.now();
  const number = `TESTV${stamp}`;
  const employer = await User.create({ email: `employer${stamp}@example.com`, name: "ACME Employer", role: "client", isActive: true, caseRole: "principal" });
  const [principal] = await Case.create([{
    caseId: number, caseNumber: number, clientPortalId: number, clientName: "ACME Employer", clientEmail: employer.email,
    visaType: "H-1B", visaCategory: "H-1B", petitionType: "H-1B", petitionSubType: "New H-1B", caseType: "immigration", status: "active",
    user: employer._id, caseStructure: "employer_employee", caseRole: "principal", childCaseCount: 0, dataEntryMode: "fill_self",
    checklistApproval: { required: false },
  }]);
  const [employerProfile] = await EmployerProfile.create([{ principalCaseId: principal._id }]);
  principal.employerProfileId = employerProfile._id;
  await principal.save();
  await User.updateOne({ _id: employer._id }, { $set: { caseIds: [principal._id] } });
  return { employer, principal };
}

const addEmployee = async (principal, employer, body) => {
  const res = mockRes();
  // errors surface through next(): record them like the HTTP error handler would, so expected refusals can be asserted
  await ctrl.addEmployeeSlot({ params: { principalId: String(principal._id) }, user: employer, body, headers: {}, ip: "test" }, res, (error) => {
    if (!error) return;
    res.statusCode = error.status || error.statusCode || 500;
    res.body = { code: error.code, message: error.message };
  });
  return res;
};

test("each employee of one employer can have a different visa, filing type and checklists", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const { employer, principal } = await employerMatter();
  const created = [];
  try {
    const a = await addEmployee(principal, employer, { visaType: "H-1B", petitionSubType: "H-1B Extension" });
    const b = await addEmployee(principal, employer, { visaType: "L-1A" });
    const c = await addEmployee(principal, employer, { visaType: "L-1B" });
    for (const res of [a, b, c]) { assert.equal(res.statusCode, 201, JSON.stringify(res.body)); created.push(res.body.childCaseId); }

    const [childA, childB, childC] = await Promise.all(created.map((id) => Case.findById(id)));
    assert.deepEqual([childA.visaType, childB.visaType, childC.visaType], ["H-1B", "L-1A", "L-1B"]);
    assert.equal(childA.petitionSubType, "H-1B Extension");
    assert.equal(childB.petitionSubType, undefined);
    assert.deepEqual([childA.visaCategory, childB.visaCategory, childC.visaCategory], ["H-1B", "L-1A", "L-1B"]);
    for (const child of [childA, childB, childC]) {
      assert.equal(String(child.parentCase), String(principal._id));
      assert.equal(String(child.employerProfileId), String(principal.employerProfileId), "all employees share the one employer record");
      assert.equal(String(child.user), String(employer._id));
    }

    // checklists are provisioned per employee from THEIR visa, never from the matter's visa
    const keysOf = async (child) => {
      const fresh = await Case.findById(child._id).lean();
      return (fresh.questionnaireReferences || []).filter((r) => r.targetRole === "employee").map((r) => String(r.title || r.questionnaireId));
    };
    const [refsA, refsB, refsC] = await Promise.all([keysOf(childA), keysOf(childB), keysOf(childC)]);
    assert.ok(refsA.length && refsB.length && refsC.length, "every employee gets an employee checklist");
    assert.notDeepEqual(refsA, refsB, "H-1B and L-1A employees do not share the same checklist");
    assert.notDeepEqual(refsB, refsC, "L-1A and L-1B employees do not share the same checklist");

    // the matter itself is untouched
    const matter = await Case.findById(principal._id);
    assert.equal(matter.visaType, "H-1B");
    assert.equal(matter.childCases.length, 3);

    // validation: filing type required where the visa has one; non-employment visas refused
    const missingSubType = await addEmployee(principal, employer, { visaType: "H-1B" });
    assert.equal(missingSubType.statusCode, 400);
    assert.equal(missingSubType.body.code, "INVALID_VISA_SUBTYPE");
    const notEmployer = await addEmployee(principal, employer, { visaType: "F-1" });
    assert.equal(notEmployer.statusCode, 400);
    assert.equal(notEmployer.body.code, "INVALID_EMPLOYEE_VISA");

    // omitting the visa keeps the old behaviour (matter's visa)
    const legacy = await addEmployee(principal, employer, { petitionSubType: "New H-1B" });
    assert.equal(legacy.statusCode, 201);
    created.push(legacy.body.childCaseId);
    assert.equal((await Case.findById(legacy.body.childCaseId)).visaType, "H-1B");
  } finally {
    await Answer.deleteMany({ caseId: { $in: created } });
    await EmployeeProfile.deleteMany({ principalCaseId: principal._id });
    await EmployerProfile.deleteMany({ principalCaseId: principal._id });
    await Case.deleteMany({ _id: { $in: [principal._id, ...created] } });
    await User.deleteMany({ _id: employer._id });
    void CaseNumberService;
  }
});
