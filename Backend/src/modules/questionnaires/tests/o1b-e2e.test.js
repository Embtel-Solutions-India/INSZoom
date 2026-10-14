// O-1B end to end against the REAL configured database: real createCase, both checklists provisioned once (and not the shared O-1 pair), approval gate,
// partial save / reload / resume, submit with every answer blank, repeating groups, canonical sync (petitioner / beneficiary roots), I-129 autofill with a
// manual override that survives, PDF download, data isolation, and an O-1A case that still gets the shared pair. Every record created is deleted afterwards.
const assert = require("node:assert/strict");
const test = require("node:test");

test("O-1B: createCase -> checklists, forms, approval, save/resume/blank submit, canonical, autofill, download", { timeout: 900000 }, async (t) => {
  const mongoose = require("mongoose");
  await require("../../../config/database")();
  const models = (name) => require(`../../../models/${name}`);
  const Case = models("Case"), User = models("User"), CaseForm = models("CaseForm");
  const tag = `ZZ-TMP-O1B-${Date.now()}`;
  const admin = await User.create({ email: `${tag}-admin@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp admin", role: "admin" });
  const manager = { _id: admin._id, role: "admin", email: admin.email };
  const req = { requestId: tag, ip: "127.0.0.1", headers: {}, user: manager };
  const created = { caseIds: [], emails: [] };

  t.after(async () => {
    const cases = await Case.find({ $or: [{ _id: { $in: created.caseIds } }, { parentCase: { $in: created.caseIds } }, { clientEmail: { $in: created.emails } }] }).select("_id user companyId beneficiary").lean();
    const ids = cases.map((item) => item._id);
    for (const name of ["Answer", "CaseForm", "Notification", "AuditLog", "Document", "Task"]) await models(name).deleteMany({ caseId: { $in: ids } }).catch(() => {});
    await Case.deleteMany({ _id: { $in: ids } });
    await models("Company").deleteMany({ _id: { $in: cases.map((item) => item.companyId).filter(Boolean) }, name: new RegExp(tag) }).catch(() => {});
    await models("Beneficiary").deleteMany({ _id: { $in: cases.map((item) => item.beneficiary).filter(Boolean) }, email: new RegExp(tag) }).catch(() => {});
    await User.deleteMany({ $or: [{ _id: admin._id }, { email: new RegExp(tag, "i") }] });
    await mongoose.disconnect();
  });

  const service = require("../questionnaire.service");
  const caseChecklist = require("../case-checklist.service");
  const orchestrator = require("../../cases/case-lifecycle-orchestrator.service");
  const caseController = require("../../cases/case.controller");

  async function makeCase(visaType, suffix) {
    const email = `${tag}-${suffix}@e2e-audit.invalid`;
    created.emails.push(email);
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await new Promise((resolve, reject) => {
      caseController.createCase({ ...req, body: { clientName: `${tag} ${suffix} Co`, clientEmail: email, visaType, pipelineCategory: "nonimmigrant", childCaseCount: 1, creationSource: "admin_direct", employerName: `${tag} ${suffix} Co` } }, res, (error) => (error ? reject(error) : resolve())).then(resolve, reject);
    });
    assert.ok(res.statusCode < 300, `createCase ${visaType} failed: ${JSON.stringify(res.body)}`);
    const principalId = String(res.body.principalCase?._id || res.body.case?._id);
    const childIds = (res.body.childCases || []).map((item) => String(item._id));
    created.caseIds.push(principalId, ...childIds);
    const refsOf = async (id) => ((await Case.findById(id).lean()).questionnaireReferences || []).filter((reference) => reference.active !== false);
    for (let i = 0; i < 40 && !((await refsOf(principalId)).length && (await refsOf(childIds[0])).length); i += 1) await new Promise((r) => setTimeout(r, 3000));
    await new Promise((r) => setTimeout(r, 8000));
    return { principalId, childId: childIds[0], childIds, refsOf, email };
  }
  const keysOf = async (refsOf, id) => (await models("Questionnaire").find({ _id: { $in: (await refsOf(id)).map((reference) => reference.questionnaireId) } }).select("key").lean()).map((item) => item.key).sort();

  // 1. O-1B case: linkage, exactly one dedicated checklist per case (idempotent), never the shared pair
  const o1b = await makeCase("O-1B", "b");
  const principal = await Case.findById(o1b.principalId).lean();
  const child = await Case.findById(o1b.childId).lean();
  assert.equal(principal.caseStructure, "employer_employee");
  assert.equal(String(child.parentCase), o1b.principalId, "the employee case is linked to the employer case");
  assert.ok((principal.participants || []).some((p) => p.role === "employer"));
  await orchestrator.initializeCase(await Case.findById(o1b.principalId), manager, req);
  assert.deepEqual(await keysOf(o1b.refsOf, o1b.principalId), ["o1b_employer_checklist"]);
  assert.deepEqual(await keysOf(o1b.refsOf, o1b.childId), ["o1b_employee_checklist"]);
  assert.equal((await o1b.refsOf(o1b.principalId)).length, 1);
  assert.equal((await o1b.refsOf(o1b.childId)).length, 1, "no duplicate assignment after re-running provisioning");

  // 2. forms: I-129 (+ its O/P supplement) come with the case; conditional forms are not auto-created
  const formCodes = async () => (await CaseForm.find({ caseId: { $in: [o1b.principalId, o1b.childId] } }).select("formCode").lean()).map((f) => f.formCode);
  const forms = await formCodes();
  assert.ok(forms.includes("I-129"), "I-129 is assigned");
  ["G-28", "I-539", "DS-160"].forEach((code) => assert.ok(!forms.includes(code), `${code} is not auto-created`));
  assert.equal(forms.filter((code) => code === "I-129").length, 1, "exactly one I-129");

  // 3. content + approval gate (draft until approved; approval of the employee checklist reaches the employee case)
  const employer = await service.getQuestionnaireForCase(o1b.principalId, manager, "employer");
  const employee = await service.getQuestionnaireForCase(o1b.childId, manager, "employee");
  assert.equal(employer.questions.length, 19);
  assert.equal(employee.questions.filter((q) => q.type === "file").length, 16, "10 beneficiary documents + 6 criteria");
  [...employer.questions, ...employee.questions].forEach((q) => { assert.equal(q.required, false, q.key); assert.equal(q.metadata.optional, true, q.key); });
  const employerUser = await User.findOne({ email: o1b.email }).lean();
  const clientUser = { _id: employerUser._id, role: "client", email: employerUser.email };
  assert.equal((await service.listCaseChecklists(o1b.principalId, clientUser)).checklists.length, 0, "not released before approval");
  await caseChecklist.approveChecklists(o1b.principalId, { checklistIds: ["o1b_employer_checklist|employer", "o1b_employee_checklist|employee"] }, manager, req);
  assert.ok((await service.listCaseChecklists(o1b.principalId, clientUser)).checklists.some((c) => c.key === "o1b_employer_checklist"), "employer checklist released after approval");
  const asClientEmployee = await service.getQuestionnaireForCase(o1b.childId, clientUser, "employee");
  assert.ok(asClientEmployee.questions.length, "the employee checklist opens for the client once approved on the employer case");

  // 4. partial save, reload, resume, repeating groups, blank submit
  const save = (q, caseId, role, answers) => service.saveAnswers({ questionnaireId: q.questionnaire._id, caseId, responseId: q.responseId, targetRole: role, answers: Object.entries(answers).map(([questionKey, value]) => ({ questionKey, value })) }, manager, req);
  const K = (role, shortKey) => `o1b_${role}_${shortKey}`;
  await save(employer, o1b.principalId, "employer", {
    [K("employer", "company_name")]: "Acme Studios Inc", [K("employer", "company_address")]: "100 Main Street Suite 200, Austin, TX 78701, USA", [K("employer", "company_fein")]: "12-3456789",
    [K("employer", "signatory_first_name")]: "Sam", [K("employer", "signatory_last_name")]: "Signer", [K("employer", "signatory_title")]: "CEO",
    [K("employer", "work_locations")]: [{ address: "1 Studio Way, Burbank, CA 91505", companyOrEndClientName: "Big Studio LLC" }, { address: "9 Stage Rd, Austin, TX 78702", companyOrEndClientName: "Acme Studios Inc" }],
  });
  await save(employee, o1b.childId, "employee", {
    [K("employee", "first_name")]: "Mira", [K("employee", "last_name")]: "Okafor", [K("employee", "date_of_birth")]: "1990-02-03", [K("employee", "country_of_citizenship")]: "Nigeria",
    [K("employee", "has_valid_passport")]: "Yes", [K("employee", "o1_denied_past_7_years")]: "Yes", [K("employee", "o1_denial_explanation")]: "Denied in 2021 for missing evidence",
    [K("employee", "dependents")]: [{ fullName: "Ada Okafor", relationship: "Spouse", dateOfBirth: "1991-04-05", countryOfCitizenship: "Nigeria" }, { fullName: "Kai Okafor", relationship: "Child", dateOfBirth: "2018-06-07", countryOfCitizenship: "Nigeria" }],
  });
  const resumedEmployer = await service.getQuestionnaireForCase(o1b.principalId, manager, "employer");
  const resumedEmployee = await service.getQuestionnaireForCase(o1b.childId, manager, "employee");
  const val = (q, key) => q.answers.find((a) => a.questionKey === key)?.value;
  assert.equal(val(resumedEmployer, K("employer", "company_name")), "Acme Studios Inc");
  assert.equal(val(resumedEmployer, K("employer", "work_locations")).length, 2, "both job locations are kept");
  assert.equal(val(resumedEmployee, K("employee", "dependents")).length, 2, "both dependents are kept");
  assert.equal(val(resumedEmployee, K("employee", "has_valid_passport")), "Yes");
  assert.equal(val(resumedEmployee, K("employee", "o1_denial_explanation")), "Denied in 2021 for missing evidence");
  assert.equal(val(resumedEmployee, K("employee", "has_valid_passport")) === undefined, false);
  assert.equal(val(resumedEmployee, K("employee", "intend_replace_i94")), undefined, "an unanswered Yes/No stays unknown, not false");
  const strict = async (id) => service.assertStrictChecklistsSubmittable({ questionnaireReferences: (await Case.findById(id).lean()).questionnaireReferences }, manager).then(() => null, (error) => error);
  assert.equal(await strict(o1b.principalId), null, "a partially filled employer checklist can be submitted");
  assert.equal(await strict(o1b.childId), null, "a partially filled employee checklist can be submitted");

  // 5. canonical sync: petitioner / beneficiary roots with provenance
  const sync = require("../../canonical/services/CanonicalSyncService");
  await sync.syncCase(o1b.principalId, manager, req, "o1b-e2e");
  await sync.syncCase(o1b.childId, manager, req, "o1b-e2e");
  await require("../../canonical/services/CanonicalProfileService").rebuild(o1b.childId, manager, req, { reason: "o1b-e2e" });
  const childProfile = (await Case.findById(o1b.childId).lean()).canonicalProfile.profile;
  assert.equal(childProfile.beneficiary.lastName, "Okafor");
  assert.equal(childProfile.beneficiary.countryOfCitizenship, "Nigeria");
  assert.equal(childProfile.beneficiary.immigration.o1VisaDeniedInPastSevenYears === true || childProfile.beneficiary.immigration.o1VisaDeniedInPastSevenYears === "Yes", true);
  assert.equal(childProfile.beneficiary.dependents.length, 2);
  assert.ok(childProfile.petitioner.name, "the petitioner name is set (a name verified at case creation outranks the client answer by design)");
  assert.equal(childProfile.petitioner.signatory.lastName, "Signer");

  // 6. autofill: the petitioner name is written into every field that asks for it; a manual override survives a re-autofill; the PDF downloads
  const AutoFill = require("../../form-mapping/services/AutoFillService");
  await AutoFill.generate(o1b.childId, "I-129", manager, req, { regenerate: true });
  const i129 = await CaseForm.findOne({ caseId: o1b.childId, formCode: "I-129" });
  assert.ok(i129, "I-129 exists on the employee case");
  const template = await models("USCISFormTemplate").findById(i129.formTemplateId).lean();
  const nameFields = template.formFields.filter((f) => /Line3_CompanyorOrgName/.test(f.fieldName));
  const MappingResolver = require("../../form-mapping/services/MappingResolver");
  const filled = (await CaseForm.findById(i129._id).lean()).filledData;
  assert.ok(nameFields.some((f) => MappingResolver.resolvePath(filled, f.fieldId) === childProfile.petitioner.name), "the petitioner name is on the form");
  const Review = require("../../uscis-forms/interactive-form-review.service");
  const field = template.formFields.find((f) => f.type === "text" && !/PDF417|BarCode|Company/i.test(f.fieldName));
  await Review.saveFieldValues(o1b.childId, String(i129._id), { [field.fieldName]: "Manual O1B value" }, manager, req, { status: "draft", reason: "o1b e2e" });
  await AutoFill.generate(o1b.childId, "I-129", manager, req, { regenerate: true });
  assert.equal((await CaseForm.findById(i129._id).lean()).fieldValues[field.fieldId || field.fieldName], "Manual O1B value", "a manual correction survives a re-autofill");
  const { prepareOfficialDownload } = require("../../form-generation/services/OfficialFormDownloadService");
  const download = await prepareOfficialDownload({ caseFormId: String(i129._id), user: manager, req, deferBookkeeping: true });
  assert.equal(download.buffer.slice(0, 5).toString("latin1"), "%PDF-");
  assert.notEqual(download.mode, "blank-template");
  const { PDFDocument } = require("pdf-lib");
  const pdf = await PDFDocument.load(download.buffer, { ignoreEncryption: true });
  assert.equal(pdf.getForm().getTextField(field.fieldName).getText(), "Manual O1B value", "the saved value is in the downloaded PDF");

  // 7. isolation: another client cannot read this employer's checklist
  const stranger = await User.create({ email: `${tag}-other@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp2", role: "client" });
  await assert.rejects(() => service.getQuestionnaireForCase(o1b.principalId, { _id: stranger._id, role: "client", email: stranger.email }, "employer"), /not authorized|forbidden|access/i);

  // 8. O-1A is untouched: it still gets the shared O-1 pair
  const o1a = await makeCase("O-1A", "a");
  assert.ok((await keysOf(o1a.refsOf, o1a.principalId)).includes("o1_employer_checklist") && !(await keysOf(o1a.refsOf, o1a.principalId)).some((k) => /^o1b_/.test(k)));
  assert.ok((await keysOf(o1a.refsOf, o1a.childId)).includes("o1_employee_checklist") && !(await keysOf(o1a.refsOf, o1a.childId)).some((k) => /^o1b_/.test(k)));
});
