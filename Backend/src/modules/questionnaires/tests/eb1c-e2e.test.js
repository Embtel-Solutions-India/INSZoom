// EB-1C end to end against the REAL configured database: an Admin creates the case through the real createCase controller (the call the Admin
// "New case" modal makes), then the two checklists are provisioned, approved, answered and checked. Every record the test creates is deleted afterwards.
const assert = require("node:assert/strict");
const test = require("node:test");

test("EB-1C: createCase -> employer + employee checklists provisioned once, forms, approval gate, optional answers, canonical sync, I-140 autofill", { timeout: 900000 }, async (t) => {
  const mongoose = require("mongoose");
  const connectDB = require("../../../config/database");
  await connectDB();
  const models = (name) => require(`../../../models/${name}`);
  const Case = models("Case");
  const User = models("User");
  const CaseForm = models("CaseForm");
  const tag = `ZZ-TMP-EB1C-${Date.now()}`;
  const admin = await User.create({ email: `${tag}-admin@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp admin", role: "admin" });
  const manager = { _id: admin._id, role: "admin", email: admin.email };
  const req = { requestId: tag, ip: "127.0.0.1", headers: {}, user: manager };
  const created = { caseIds: [], userEmail: `${tag}-employer@e2e-audit.invalid` };

  t.after(async () => {
    const cases = await Case.find({ $or: [{ _id: { $in: created.caseIds } }, { parentCase: { $in: created.caseIds } }, { clientEmail: created.userEmail }] }).select("_id user companyId beneficiary clientProfile").lean();
    const ids = cases.map((item) => item._id);
    for (const name of ["Answer", "CaseForm", "Notification", "AuditLog", "Document", "Task"]) await models(name).deleteMany({ caseId: { $in: ids } }).catch(() => {});
    const userIds = [...new Set(cases.map((item) => String(item.user || "")).filter(Boolean))];
    await Case.deleteMany({ _id: { $in: ids } });
    await models("Company").deleteMany({ _id: { $in: cases.map((item) => item.companyId).filter(Boolean) }, name: new RegExp(tag) }).catch(() => {});
    await models("Beneficiary").deleteMany({ _id: { $in: cases.map((item) => item.beneficiary).filter(Boolean) }, email: new RegExp(tag) }).catch(() => {});
    await User.deleteMany({ $or: [{ _id: { $in: userIds }, email: new RegExp(tag) }, { _id: admin._id }, { email: new RegExp(tag) }] });
    await mongoose.disconnect();
  });

  const service = require("../questionnaire.service");
  const caseChecklist = require("../case-checklist.service");
  const orchestrator = require("../../cases/case-lifecycle-orchestrator.service");
  const caseController = require("../../cases/case.controller");

  // 1. the real Admin call
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await new Promise((resolve, reject) => {
    caseController.createCase({
      ...req,
      body: { clientName: `${tag} Holdings`, clientEmail: created.userEmail, visaType: "EB-1C", pipelineCategory: "immigrant", childCaseCount: 1, creationSource: "admin_direct", employerName: `${tag} Holdings` },
    }, res, (error) => (error ? reject(error) : resolve())).then(resolve, reject);
  });
  assert.ok(res.statusCode < 300, `createCase failed: ${JSON.stringify(res.body)}`);
  const principalId = res.body.case?._id || res.body.case?.id || res.body.principalCase?._id;
  assert.ok(principalId, "a principal case is returned");
  created.caseIds.push(principalId);
  const childIds = (res.body.childCases || []).map((item) => item._id || item.id);
  created.caseIds.push(...childIds);

  // 2. structure and linkage
  const principal = await Case.findById(principalId).lean();
  assert.equal(principal.visaType, "EB-1C");
  assert.equal(principal.caseStructure, "employer_employee");
  assert.equal(childIds.length, 1, "one employee (beneficiary) case");
  const child = await Case.findById(childIds[0]).lean();
  assert.equal(String(child.parentCase), String(principalId), "the employee case is linked to the petitioner case");
  assert.equal(principal.caseRole, "principal");
  assert.equal(child.caseRole, "employee");
  assert.ok(principal.employerUser, "the petitioner (employer) account owns the principal case");
  assert.equal(String(child.user), String(principal.employerUser), "the employee case is created under the same petitioner account until the employee is invited");
  assert.ok((principal.participants || []).some((participant) => participant.role === "employer"), "an employer participant exists");
  assert.ok((principal.participants || []).some((participant) => participant.role === "employee"), "an employee participant slot exists");
  assert.equal((principal.childCases || []).map(String).includes(String(child._id)), true, "the principal lists the employee case");

  // 3. provisioning (run by the background lifecycle after createCase): wait for it, then run it again - nothing is duplicated
  const refsOf = async (id) => ((await Case.findById(id).lean()).questionnaireReferences || []).filter((reference) => reference.active !== false);
  for (let i = 0; i < 40 && !((await refsOf(principalId)).length && (await refsOf(childIds[0])).length); i += 1) await new Promise((r) => setTimeout(r, 3000));
  await new Promise((r) => setTimeout(r, 8000));
  await orchestrator.initializeCase(await Case.findById(principalId), manager, req);
  // the stored assignments (the staff listing also resolves every default checklist of the visa type, exactly as it does for EB-1B)
  const keysOf = async (id) => (await models("Questionnaire").find({ _id: { $in: (await refsOf(id)).map((reference) => reference.questionnaireId) } }).select("key").lean()).map((item) => item.key).sort();
  assert.deepEqual(await keysOf(principalId), ["eb1c_employer_checklist"], "the principal carries the employer checklist only");
  assert.deepEqual(await keysOf(childIds[0]), ["eb1c_employee_checklist"], "the employee case carries the employee checklist only");
  assert.equal((await refsOf(principalId)).length, 1);
  assert.equal((await refsOf(childIds[0])).length, 1, "no duplicate checklist assignment after a re-run");

  // 4. forms: Form I-140 only (idempotent); nothing conditional is auto-created
  const formCodes = (await CaseForm.find({ caseId: { $in: [principalId, ...childIds] } }).select("formCode").lean()).map((form) => form.formCode).sort();
  assert.deepEqual(formCodes.filter((code) => code === "I-140"), ["I-140"], "exactly one I-140");
  ["I-485", "I-765", "I-131", "I-907", "G-28", "I-693", "I-864"].forEach((code) => assert.ok(!formCodes.includes(code), `${code} is not auto-created`));

  // 5. content: every requirement present, exact label, optional
  const employer = await service.getQuestionnaireForCase(principalId, manager, "employer");
  const employee = await service.getQuestionnaireForCase(childIds[0], manager, "employee");
  assert.equal(employer.questionnaire.title, "EB-1C Employer/Petitioner Checklist");
  assert.equal(employee.questionnaire.title, "EB-1C Employee/Beneficiary Checklist");
  assert.equal(employer.questions.length, 31, "29 uploads + 2 website URLs");
  assert.ok(employer.questions.some((q) => q.label === "Articles of Incorporation") && employer.questions.some((q) => q.label === "Board Resolution approving establishment of U.S. entity."));
  [...employer.questions, ...employee.questions].forEach((q) => { assert.equal(q.required, false, q.key); assert.equal(q.metadata.optional, true, q.key); });
  assert.ok(!employee.questions.some((q) => /^eb1c_spouse_/.test(q.key)) && !employee.questions.some((q) => /^eb1c_child_/.test(q.key)), "family documents hidden until answered");

  // 6. approval gate for a client-side user, then release
  const employerUser = await User.findOne({ email: created.userEmail }).lean();
  assert.ok(employerUser, "the employer contact account exists");
  const clientUser = { _id: employerUser._id, role: "client", email: employerUser.email };
  assert.equal((await service.listCaseChecklists(principalId, clientUser)).checklists.length, 0, "not released yet");
  await caseChecklist.approveChecklists(principalId, { checklistIds: ["eb1c_employer_checklist|employer"] }, manager, req);
  assert.equal((await service.listCaseChecklists(principalId, clientUser)).checklists.length, 1, "released after approval");
  await caseChecklist.approveChecklists(childIds[0], { checklistIds: ["eb1c_employee_checklist|employee"] }, manager, req);

  // 7. partial answers save and persist; conditional family documents appear only when the optional answers say so
  const A = (questionKey, value) => ({ questionKey, value });
  const saveEmployer = (answers) => service.saveAnswers({ questionnaireId: employer.questionnaire._id, caseId: String(principalId), responseId: employer.responseId, targetRole: "employer", answers }, manager, req);
  const saveEmployee = (answers) => service.saveAnswers({ questionnaireId: employee.questionnaire._id, caseId: String(childIds[0]), responseId: employee.responseId, targetRole: "employee", answers }, manager, req);
  await saveEmployer([A("eb1c_us_website_url", "https://www.acme-us.example.com"), A("eb1c_foreign_website_url", "https://www.acme-india.example.in")]);
  await saveEmployee([A("eb1c_has_spouse", "Yes"), A("eb1c_has_children", "Yes"), A("eb1c_child_count", 2), A("eb1c_duties_managing_function_pct", 40), A("eb1c_duties_supervision_pct", 30)]);
  const employeeAfter = await service.getQuestionnaireForCase(childIds[0], manager, "employee");
  const shown = new Set(employeeAfter.questions.map((q) => q.key));
  ["eb1c_spouse_passport", "eb1c_spouse_marriage_certificate", "eb1c_child_1_passport", "eb1c_child_2_birth_certificate"].forEach((key) => assert.ok(shown.has(key), `${key} shown`));
  assert.ok(!shown.has("eb1c_child_3_passport"), "only as many child records as children");
  assert.equal(employeeAfter.answers.find((a) => a.questionKey === "eb1c_duties_managing_function_pct").value, 40);

  // 8. submission rules: blank and partial percentages are accepted; four percentages that do not add up to 100 are refused
  const strict = async (id) => service.assertStrictChecklistsSubmittable({ questionnaireReferences: (await Case.findById(id).lean()).questionnaireReferences }, manager).then(() => null, (error) => error);
  assert.equal(await strict(principalId), null, "an employer checklist with almost everything blank can be submitted");
  assert.equal(await strict(childIds[0]), null, "a partial set of duty percentages is not judged");
  await saveEmployee([A("eb1c_duties_personnel_authority_pct", 20), A("eb1c_duties_operational_discretion_pct", 20)]);
  const wrongTotal = await strict(childIds[0]);
  assert.equal(wrongTotal?.code, "CHECKLIST_INVALID", "all four answered and adding up to 110 is refused");
  assert.match(wrongTotal.message, /add up to 100/);
  await saveEmployee([A("eb1c_duties_operational_discretion_pct", 10)]);
  assert.equal(await strict(childIds[0]), null, "40 + 30 + 20 + 10 = 100 is accepted");
  await saveEmployee([A("eb1c_duties_managing_function_pct", 150)]); // a draft save is never blocked ...
  const outOfRange = await strict(childIds[0]); // ... but the submit check refuses a percentage outside 0-100
  assert.equal(outOfRange?.code, "CHECKLIST_INVALID");
  assert.match(outOfRange.message, /between 0 and 100/);
  await saveEmployee([A("eb1c_duties_managing_function_pct", 40)]);

  // 9. canonical sync: scalar answers land on their canonical paths with provenance; unanswered stays unknown (not false)
  const sync = require("../../canonical/services/CanonicalSyncService");
  await sync.syncCase(principalId, manager, req, "eb1c-e2e");
  await sync.syncCase(childIds[0], manager, req, "eb1c-e2e");
  const principalProfile = (await Case.findById(principalId).lean()).canonicalProfile;
  const childProfile = (await Case.findById(childIds[0]).lean()).canonicalProfile;
  assert.equal(principalProfile.profile.petitioner.usCompany.websiteUrl, "https://www.acme-us.example.com");
  assert.equal(principalProfile.profile.petitioner.foreignCompany.websiteUrl, "https://www.acme-india.example.in");
  assert.equal(childProfile.profile.beneficiary.family.hasSpouse, true);
  assert.equal(childProfile.profile.beneficiary.family.childCount, 2);
  assert.equal(childProfile.profile.beneficiary.foreignEmployment.duties.supervisionOrEssentialFunctionPercentage, 30);
  assert.equal(childProfile.fieldMetadata["beneficiary.family.hasSpouse"].sourceType, "questionnaire");

  // 10. a client of another employer cannot read this employer's checklist
  const stranger = await User.create({ email: `${tag}-other@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp2", role: "client" });
  await assert.rejects(() => service.getQuestionnaireForCase(principalId, { _id: stranger._id, role: "client", email: stranger.email }, "employer"), /not authorized|forbidden|access/i);
});
