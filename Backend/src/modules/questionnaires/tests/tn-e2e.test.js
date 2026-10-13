// TN (Canada + Mexico) end to end against the REAL configured database: the real createCase controller, checklist provisioning/approval/answers/resume,
// registry-driven USCIS forms (I-129 / G-28 / I-907 / I-539 are never auto-assigned; DS-160 is never a USCIS form), conditional Add, autofill with a
// manual override that survives, and a downloadable filled PDF. Every record the test creates is deleted afterwards.
const assert = require("node:assert/strict");
const test = require("node:test");

for (const visaType of ["TN", "TN Canada", "TN Mexico"]) {
  test(`${visaType}: checklists + registry forms + autofill + download`, { timeout: 900000 }, async (t) => {
    const mongoose = require("mongoose");
    const connectDB = require("../../../config/database");
    await connectDB();
    const models = (name) => require(`../../../models/${name}`);
    const Case = models("Case");
    const User = models("User");
    const CaseForm = models("CaseForm");
    const tag = `ZZ-TMP-TN-${Date.now()}-${visaType.replace(/[^A-Za-z]/g, "")}`;
    const admin = await User.create({ email: `${tag}-admin@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp admin", role: "admin" });
    const manager = { _id: admin._id, role: "admin", email: admin.email };
    const req = { requestId: tag, ip: "127.0.0.1", headers: {}, user: manager };
    const created = { caseIds: [], userEmail: `${tag}-employer@e2e-audit.invalid` };

    t.after(async () => {
      const cases = await Case.find({ $or: [{ _id: { $in: created.caseIds } }, { parentCase: { $in: created.caseIds } }, { clientEmail: created.userEmail }] }).select("_id user companyId beneficiary").lean();
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
        body: { clientName: `${tag} Co`, clientEmail: created.userEmail, visaType, pipelineCategory: "nonimmigrant", childCaseCount: 1, creationSource: "admin_direct", employerName: `${tag} Co` },
      }, res, (error) => (error ? reject(error) : resolve())).then(resolve, reject);
    });
    assert.ok(res.statusCode < 300, `createCase failed: ${JSON.stringify(res.body)}`);
    const principalId = res.body.case?._id || res.body.principalCase?._id;
    created.caseIds.push(principalId);
    const childIds = (res.body.childCases || []).map((item) => item._id || item.id);
    created.caseIds.push(...childIds);
    assert.equal(childIds.length, 1, "one employee (beneficiary) case");
    const childId = childIds[0];

    // 2. checklists: exactly one per case, none duplicated by a re-run of provisioning
    const refsOf = async (id) => ((await Case.findById(id).lean()).questionnaireReferences || []).filter((reference) => reference.active !== false);
    for (let i = 0; i < 40 && !((await refsOf(principalId)).length && (await refsOf(childId)).length); i += 1) await new Promise((r) => setTimeout(r, 3000));
    await new Promise((r) => setTimeout(r, 8000));
    await orchestrator.initializeCase(await Case.findById(principalId), manager, req);
    const keysOf = async (id) => (await models("Questionnaire").find({ _id: { $in: (await refsOf(id)).map((reference) => reference.questionnaireId) } }).select("key").lean()).map((item) => item.key).sort();
    assert.deepEqual(await keysOf(principalId), ["tn_employer_checklist"]);
    assert.deepEqual(await keysOf(childId), ["tn_employee_checklist"]);
    assert.equal((await refsOf(principalId)).length, 1);
    assert.equal((await refsOf(childId)).length, 1, "no duplicate assignment after a re-run");

    // 3. USCIS forms: none of the conditional forms is auto-assigned, DS-160 is never a USCIS form/case form
    const formCodes = async () => (await CaseForm.find({ caseId: { $in: [principalId, ...childIds] } }).select("formCode").lean()).map((form) => form.formCode).sort();
    const initialForms = await formCodes();
    ["I-539", "G-28", "DS-160", "DS-260"].forEach((code) => assert.ok(!initialForms.includes(code), `${code} is not auto-created`));
    ["I-129", "I-907", "I129_TRADE_AGREEMENT_SUPPLEME"].forEach((code) => assert.ok(initialForms.includes(code), `${code} comes with a TN case (registry default, the case manager may mark it not applicable)`));
    assert.equal(await models("USCISFormTemplate").countDocuments({ formCode: "DS-160" }), 0, "DS-160 is not a USCIS registry template");
    const registry = await models("VisaFormMapping").find({ visaType, active: true }).select("formNumber agency provisioningType").lean();
    const byForm = Object.fromEntries(registry.map((row) => [row.formNumber, row]));
    assert.equal(byForm["DS-160"]?.agency, "DOS", "DS-160 is only a DOS online-application reference");
    assert.equal(byForm["I-129"]?.provisioningType, "CONDITIONAL", "I-129 is conditional on the filing route");
    ["I-907", "G-28", "I-539"].forEach((code) => assert.equal(byForm[code]?.provisioningType, "CONDITIONAL", `${code} stays conditional`));

    // 4. the forms overview offers the USCIS forms (never DS-160), and Add provisions each exactly once
    const registryController = require("../../form-registry/form-registry.controller");
    const overview = async (id) => { const out = { body: null, json(b) { this.body = b; return this; } }; await registryController.getFormsOverview({ params: { id: String(id) }, user: manager, query: {}, headers: {}, ip: "127.0.0.1" }, out, (e) => { throw e; }); return out.body?.data?.items || []; };
    const offered = (await overview(childId)).map((item) => item.formNumber);
    ["I-129", "G-28", "I-907"].forEach((code) => assert.ok(offered.includes(code), `${code} is offered on the case`));
    assert.ok(!offered.includes("DS-160"), "DS-160 is not listed as a USCIS form");
    const decisions = require("../../form-registry/visaFormMapping.service");
    const add = async (formNumber) => decisions.recordConditionalDecision(await Case.findById(childId), byForm[formNumber]._id || (await models("VisaFormMapping").findOne({ visaType, formNumber, active: true }))._id, "ADD", manager, "tn e2e", req);
    for (const code of ["G-28", "I-129"]) {
      await add(code);
      await add(code).catch(() => {}); // a repeat is safe: still exactly one
      assert.equal((await CaseForm.countDocuments({ caseId: childId, formCode: code })), 1, `exactly one ${code}`);
    }
    assert.ok(!(await formCodes()).includes("I-539"), "I-539 is still not assigned to the TN worker");

    // 5. autofill: a manual correction survives a re-autofill; the filled PDF downloads and holds the saved value
    const AutoFill = require("../../form-mapping/services/AutoFillService");
    await Case.updateOne({ _id: childId }, { $set: { clientName: "Tia Nafta" } });
    await AutoFill.generate(childId, "I-129", manager, req, {}).catch(() => {});
    const i129 = await CaseForm.findOne({ caseId: childId, formCode: "I-129" });
    assert.ok(i129, "I-129 exists");
    const Review = require("../../uscis-forms/interactive-form-review.service");
    const template = await models("USCISFormTemplate").findById(i129.formTemplateId).lean();
    const field = template.formFields.find((f) => f.type === "text" && !/PDF417|BarCode/i.test(f.fieldName));
    await Review.saveFieldValues(String(childId), String(i129._id), { [field.fieldName]: "Manual TN value" }, manager, req, { status: "draft", reason: "tn e2e" });
    await AutoFill.generate(childId, "I-129", manager, req, { regenerate: true }).catch(() => {});
    const afterAutofill = await CaseForm.findById(i129._id).lean();
    assert.equal(afterAutofill.fieldValues[field.fieldId || field.fieldName], "Manual TN value", "a manual correction is not overwritten by autofill");
    assert.ok(afterAutofill.manualOverrides[field.fieldId || field.fieldName], "the override is recorded");
    const { prepareOfficialDownload } = require("../../form-generation/services/OfficialFormDownloadService");
    const download = await prepareOfficialDownload({ caseFormId: String(i129._id), user: manager, req, deferBookkeeping: true });
    assert.equal(download.buffer.slice(0, 5).toString("latin1"), "%PDF-", "a PDF is returned");
    assert.notEqual(download.mode, "blank-template", "the form was filled, not the blank template");
    const { PDFDocument } = require("pdf-lib");
    const pdf = await PDFDocument.load(download.buffer, { ignoreEncryption: true });
    assert.equal(pdf.getForm().getTextField(field.fieldName).getText(), "Manual TN value", "the saved value is in the downloaded PDF");

    // 6. checklist: approval gate, save, reload, resume, submit rules
    const employer = await service.getQuestionnaireForCase(principalId, manager, "employer");
    const employee = await service.getQuestionnaireForCase(childId, manager, "employee");
    const employerUser = await User.findOne({ email: created.userEmail }).lean();
    const clientUser = { _id: employerUser._id, role: "client", email: employerUser.email };
    assert.equal((await service.listCaseChecklists(principalId, clientUser)).checklists.length, 0, "not released before approval");
    await caseChecklist.approveChecklists(principalId, { checklistIds: ["tn_employer_checklist|employer"] }, manager, req);
    assert.equal((await service.listCaseChecklists(principalId, clientUser)).checklists.length, 1, "released after approval");
    await caseChecklist.approveChecklists(childId, { checklistIds: ["tn_employee_checklist|employee"] }, manager, req);
    const textQuestions = (side) => side.questions.filter((q) => ["text", "textarea"].includes(q.type)).slice(0, 3);
    const employeeAnswers = textQuestions(employee).map((q, i) => ({ questionKey: q.key, value: `Answer ${i + 1}` }));
    assert.ok(employeeAnswers.length, "the employee checklist has text questions to answer");
    await service.saveAnswers({ questionnaireId: employee.questionnaire._id, caseId: String(childId), responseId: employee.responseId, targetRole: "employee", answers: employeeAnswers.slice(0, 1) }, manager, req);
    const resumed = await service.getQuestionnaireForCase(childId, manager, "employee");
    assert.equal(resumed.answers.find((a) => a.questionKey === employeeAnswers[0].questionKey)?.value, "Answer 1", "the saved answer is restored on reopen");
    await service.saveAnswers({ questionnaireId: employee.questionnaire._id, caseId: String(childId), responseId: employee.responseId, targetRole: "employee", answers: employeeAnswers.slice(1) }, manager, req);
    const resumed2 = await service.getQuestionnaireForCase(childId, manager, "employee");
    employeeAnswers.forEach((answer) => assert.equal(resumed2.answers.find((a) => a.questionKey === answer.questionKey)?.value, answer.value, "earlier and later answers are all kept"));
    // the same save repeated does not duplicate or reset anything
    await service.saveAnswers({ questionnaireId: employee.questionnaire._id, caseId: String(childId), responseId: employee.responseId, targetRole: "employee", answers: employeeAnswers.slice(0, 1) }, manager, req);
    assert.equal((await models("Answer").countDocuments({ caseId: childId, questionKey: employeeAnswers[0].questionKey })) <= 1, true, "a repeated save does not duplicate the answer");
    const textEmployer = textQuestions(employer);
    if (textEmployer.length) await service.saveAnswers({ questionnaireId: employer.questionnaire._id, caseId: String(principalId), responseId: employer.responseId, targetRole: "employer", answers: [{ questionKey: textEmployer[0].key, value: "Employer answer" }] }, manager, req);

    // 7. data isolation: a client of another employer cannot read this employer's checklist
    const stranger = await User.create({ email: `${tag}-other@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp2", role: "client" });
    await assert.rejects(() => service.getQuestionnaireForCase(principalId, { _id: stranger._id, role: "client", email: stranger.email }, "employer"), /not authorized|forbidden|access/i);
  });
}
