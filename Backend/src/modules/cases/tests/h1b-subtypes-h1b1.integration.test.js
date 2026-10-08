// Every H-1B filing type gets the H-1B forms, and H-1B1 (plain, Chile, Singapore) is filed exactly like H-1B: the same forms and the
// same client checklists. Runs real provisioning against the test database.
const assert = require("node:assert/strict");
const test = require("node:test");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const User = require("../../../models/User");
const CaseLifecycleOrchestrator = require("../case-lifecycle-orchestrator.service");
const KnowledgeEngine = require("../immigration-knowledge-engine.service");
const visaFormMappingService = require("../../form-registry/visaFormMapping.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const { filedLikeVisa } = require("../../../config/visaHierarchy");

const req = { ip: "127.0.0.1", headers: {} };
const SUBTYPES = ["New H-1B", "H-1B Extension", "H-1B Transfer", "H-1B Amendment", "H-1B Concurrent"];
const created = { cases: [], user: null };
let owner;

test.before(async () => {
  await connectTestDB();
  await questionnaireService.ensureTemplatesForVisa("H-1B1", undefined, undefined, { wait: true });
  await new Promise((resolve) => setTimeout(resolve, 6000)); // lets the template refresh finish
  owner = await User.create({ email: `h1b-${Date.now()}@example.com`, name: "H1B Owner", role: "client", isActive: true, caseRole: "principal" });
  created.user = owner._id;
});

test.after(async () => {
  await CaseForm.deleteMany({ caseId: { $in: created.cases } });
  await Case.deleteMany({ _id: { $in: created.cases } });
  if (created.user) await User.deleteOne({ _id: created.user });
  await disconnectTestDB();
});

async function makeCase(visaType, petitionSubType, caseRole = "principal", parent = null) {
  const number = `TESTH${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const [doc] = await Case.create([{
    caseId: number, caseNumber: number, clientPortalId: number, clientName: "H1B Test", clientEmail: owner.email, visaType, visaCategory: visaType, petitionType: visaType,
    petitionSubType, caseType: "immigration", status: "active", user: owner._id, caseStructure: "employer_employee", caseRole,
    ...(parent ? { parentCase: parent, childIndex: "A" } : { childCaseCount: 1 }), checklistApproval: { required: false },
  }]);
  created.cases.push(doc._id);
  return doc;
}

const formCodes = async (caseDoc) => {
  await CaseLifecycleOrchestrator.provisionRequiredForms(caseDoc, { _id: owner._id, role: "admin" }, req);
  return (await CaseForm.find({ caseId: caseDoc._id }).select("formCode").lean()).map((form) => form.formCode).sort();
};

test("H-1B1 (all variants) is filed like H-1B", () => {
  for (const visa of ["H-1B1", "H-1B1 Chile", "H-1B1 Singapore"]) assert.equal(filedLikeVisa(visa), "H-1B");
  assert.equal(filedLikeVisa("H-1B"), "H-1B");
  for (const label of ["New H-1B", "H-1B Extension", "H1B Transfer", "H-1B Amendment", "H-1B Concurrent"]) assert.equal(filedLikeVisa(label), "H-1B", label);
  assert.equal(filedLikeVisa("L-1A"), "L-1A", "other visas are untouched");
});

test("every H-1B filing type gets the same H-1B forms", async () => {
  const baseline = await formCodes(await makeCase("H-1B", undefined));
  assert.ok(baseline.includes("I-129"), `H-1B provisions I-129 (got ${baseline.join(", ")})`);
  for (const subtype of SUBTYPES) {
    const codes = await formCodes(await makeCase("H-1B", subtype));
    assert.deepEqual(codes, baseline, `${subtype} gets the same forms as H-1B`);
  }
});

test("H-1B1, H-1B1 Chile and H-1B1 Singapore get exactly the H-1B forms", async () => {
  const baseline = await formCodes(await makeCase("H-1B", "New H-1B"));
  for (const visa of ["H-1B1", "H-1B1 Chile", "H-1B1 Singapore"]) {
    const codes = await formCodes(await makeCase(visa, undefined));
    assert.deepEqual(codes, baseline, `${visa} gets the same forms as H-1B`);
  }
  const registry = async (visaType) => {
    const result = await visaFormMappingService.resolveVisaFormMappings({ visaType, petitionType: visaType, caseType: "immigration" });
    return [...result.autoCreate, ...result.conditional, ...result.laterStage, ...result.reference].map((entry) => entry.mapping.formNumber).sort();
  };
  assert.deepEqual(await registry("H-1B1"), await registry("H-1B"));
});

test("H-1B1 gets the H-1B employer and employee checklists", async () => {
  for (const visa of ["H-1B", "H-1B1", "H-1B1 Chile", "H-1B1 Singapore"]) {
    const principal = await makeCase(visa, undefined);
    const child = await makeCase(visa, undefined, "employee", principal._id);
    const employer = await questionnaireService.getQuestionnaireForCase(principal._id, owner, "employer");
    const employee = await questionnaireService.getQuestionnaireForCase(child._id, owner, "employee");
    assert.equal(employer.questionnaire.key, "h1b_employer_checklist", `${visa} employer checklist`);
    assert.equal(employee.questionnaire.key, "h1b_employee_checklist", `${visa} employee checklist`);
    const assignedPrincipal = (await KnowledgeEngine.applicableQuestionnaires(principal)).map((item) => item.key);
    assert.ok(assignedPrincipal.includes("h1b_employer_checklist"), `${visa} is assigned the H-1B employer checklist automatically (got ${assignedPrincipal.join(", ")})`);
    const assignedChild = (await KnowledgeEngine.applicableQuestionnaires(child)).map((item) => item.key);
    assert.ok(assignedChild.includes("h1b_employee_checklist"), `${visa} is assigned the H-1B employee checklist automatically (got ${assignedChild.join(", ")})`);
  }
});

// What the case's Forms tab actually lists (GET /uscis-forms/case/:id) - not just what was provisioned.
test("the Forms tab lists the same forms for every H-1B filing type and every H-1B1 variant", async () => {
  const listed = async (visa, subtype) => {
    const caseDoc = await makeCase(visa, subtype);
    await CaseLifecycleOrchestrator.provisionRequiredForms(caseDoc, { _id: owner._id, role: "admin" }, req);
    const forms = await uscisFormService.listCaseForms(caseDoc._id, { _id: owner._id, role: "admin" }, req);
    return (Array.isArray(forms) ? forms : forms?.forms || []).map((form) => form.formCode || form.formNumber || form.code).sort();
  };
  const baseline = await listed("H-1B", undefined);
  assert.ok(baseline.length > 0, "the Forms tab lists forms for an H-1B case");
  for (const subtype of SUBTYPES) assert.deepEqual(await listed("H-1B", subtype), baseline, `${subtype}: Forms tab`);
  for (const visa of ["H-1B1", "H-1B1 Chile", "H-1B1 Singapore"]) assert.deepEqual(await listed(visa, undefined), baseline, `${visa}: Forms tab`);
});

// Employer matters choose the visa and filing type per EMPLOYEE: each employee case gets the visa's forms too.
test("employee cases get the same forms for every H-1B filing type and every H-1B1 variant", async () => {
  const listedForEmployee = async (visa, subtype) => {
    const principal = await makeCase(visa, subtype);
    const child = await makeCase(visa, subtype, "employee", principal._id);
    await CaseLifecycleOrchestrator.provisionRequiredForms(child, { _id: owner._id, role: "admin" }, req);
    const forms = await uscisFormService.listCaseForms(child._id, { _id: owner._id, role: "admin" }, req);
    return (Array.isArray(forms) ? forms : forms?.forms || []).map((form) => form.formCode || form.formNumber || form.code).sort();
  };
  const baseline = await listedForEmployee("H-1B", "New H-1B");
  console.log("EMPLOYEE FORMS (H-1B / New H-1B):", baseline.join(", ") || "(none)");
  for (const subtype of SUBTYPES) assert.deepEqual(await listedForEmployee("H-1B", subtype), baseline, `${subtype}: employee forms`);
  for (const visa of ["H-1B1", "H-1B1 Chile", "H-1B1 Singapore"]) assert.deepEqual(await listedForEmployee(visa, undefined), baseline, `${visa}: employee forms`);
});
