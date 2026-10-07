// GC-NVC (checklist-driven, no USCIS forms) and PERM: registry rules, the gc_nvc_checklist definition, and the end-to-end workflow
//   Admin creates the case -> checklist provisioned (draft, Case Manager side) -> CM approves -> client answers/saves -> Admin sees them.
// The first groups are pure. The last one runs the real provisioning/answer pipeline against ONE temporary case (and client) in the
// database and removes everything it created, whether or not it passes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { hasNoForms, getFormIds, getNoFormChecklistKeys, getCaseStructure } = require("../../../config/visaCategories");
const { buildGcNvcChecklist, CHECKLIST_KEY, SECURITY_QUESTION_KEYS } = require("../gcNvcChecklist");
const family = require("../../family-workflow/questionnaires/familyBasedImmigrantPetition");

const checklist = buildGcNvcChecklist();
const byKey = new Map(checklist.questions.map((question) => [question.key, question]));
const question = (name) => byKey.get(`gc_nvc_${name}`);
const rulesOf = (name) => question(name).conditionalLogic.rules;

// ── registry ─────────────────────────────────────────────────────────────
test("GC-NVC and PERM are checklist-driven case types with no forms", () => {
  for (const visaType of ["GC-NVC", "PERM"]) {
    assert.equal(hasNoForms(visaType), true, visaType);
    assert.deepEqual(getFormIds(visaType), [], `${visaType} lists no forms`);
  }
  assert.deepEqual(getNoFormChecklistKeys("GC-NVC"), ["gc_nvc_checklist"]);
  assert.deepEqual(getNoFormChecklistKeys("PERM"), ["perm_employer_information", "perm_employee_information"]);
  assert.equal(typeof getCaseStructure === "function" ? getCaseStructure("GC-NVC") : "single", "single");
});

test("the form registry has no GC-NVC or PERM rows, and PERM adds no ETA forms", () => {
  const seed = fs.readFileSync(path.join(__dirname, "..", "..", "form-registry", "seeds", "visaFormMappings.seed.js"), "utf8");
  assert.ok(!/\b(m|ds260|add)\(\s*"GC-NVC"/.test(seed), "no GC-NVC form rows");
  assert.ok(!/\b(m|ds260|add)\(\s*"PERM"/.test(seed), "no PERM form rows");
  assert.ok(!/ETA-9(089|141)[^\n]*"(GC-NVC|PERM)"/.test(seed) && !/"(GC-NVC|PERM)"[^\n]*ETA-9(089|141)/.test(seed), "ETA forms are not provisioned for either type");
});

// ── definition ───────────────────────────────────────────────────────────
test("gc_nvc_checklist is the one client checklist, provisioned by default for GC-NVC", () => {
  assert.equal(checklist.key, CHECKLIST_KEY);
  assert.equal(checklist.checklistRole, "client");
  assert.equal(checklist.isDefault, true);
  assert.deepEqual(checklist.visaTypes, ["GCNVC"]);
  assert.equal(new Set(checklist.questions.map((item) => item.key)).size, checklist.questions.length, "no duplicate keys");
});

test("the six required documents are file questions on the existing document requirement shape", () => {
  const files = checklist.questions.filter((item) => item.type === "file");
  assert.equal(files.length, 6);
  assert.deepEqual(files.map((item) => item.metadata.documentType).sort(), family.gcNvcDocuments.map((doc) => doc.documentType).sort());
});

test("Part 11 keeps all 53 supplied questions verbatim, each with its own conditional explanation", () => {
  assert.equal(family.GC_NVC_SECURITY_QUESTIONS.length, 53);
  assert.equal(SECURITY_QUESTION_KEYS.length, 53);
  family.GC_NVC_SECURITY_QUESTIONS.forEach((label, index) => {
    const item = byKey.get(SECURITY_QUESTION_KEYS[index]);
    assert.equal(item.label, label, `Q${index + 1} wording is untouched`);
    assert.equal(item.type, "radio");
    assert.equal(item.required, true);
    assert.equal(item.metadata.questionNumber, index + 1);
    const explanation = byKey.get(`gc_nvc_security_q${index + 1}_explanation`);
    assert.equal(explanation.type, "textarea");
    assert.deepEqual(explanation.conditionalLogic.rules, [{ questionKey: SECURITY_QUESTION_KEYS[index], operator: "equals", value: "Yes" }]);
  });
  assert.match(family.GC_NVC_SECURITY_QUESTIONS[0], /^Do you have a communicable disease of public health significance such as tuberculosis \(TB\)\?$/);
  assert.match(family.GC_NVC_SECURITY_QUESTIONS[52], /^Are you likely to become a public charge after you are admitted to the United States\?$/);
  const general = byKey.get("gc_nvc_security_general_explanation");
  assert.equal(general.label, "If you answer yes to any of the above questions, please explain below:");
  assert.equal(general.conditionalLogic.mode, "any");
  assert.equal(general.conditionalLogic.rules.length, 53);
});

test("conditional questions depend on their Yes/No answer and are not globally required", () => {
  assert.deepEqual(rulesOf("children_count"), [{ questionKey: "gc_nvc_has_children", operator: "equals", value: "Yes" }]);
  assert.deepEqual(rulesOf("children"), [{ questionKey: "gc_nvc_has_children", operator: "equals", value: "Yes" }]);
  assert.deepEqual(rulesOf("father_address"), [{ questionKey: "gc_nvc_father_living", operator: "equals", value: "Yes" }]);
  assert.deepEqual(rulesOf("father_year_of_death"), [{ questionKey: "gc_nvc_father_living", operator: "equals", value: "No" }]);
  assert.deepEqual(rulesOf("mother_address"), [{ questionKey: "gc_nvc_mother_living", operator: "equals", value: "Yes" }]);
  assert.deepEqual(rulesOf("mother_year_of_death"), [{ questionKey: "gc_nvc_mother_living", operator: "equals", value: "No" }]);
  for (const name of ["mailing_street", "delivery_address", "other_nationality_country", "other_phones", "other_emails", "visa_issued_date", "military_branch", "training_job_title", "employment_history", "education_history", "countries_traveled"]) {
    assert.ok(question(name).conditionalLogic.rules.length >= 1, `${name} is conditional`);
  }
  // every condition points at a question that exists
  for (const item of checklist.questions) for (const rule of item.conditionalLogic.rules || []) assert.ok(byKey.has(rule.questionKey), `${item.key} -> ${rule.questionKey}`);
  // the always-asked gates are required, the optional ones are not
  for (const name of ["has_children", "father_living", "mother_living", "been_to_us", "has_other_phones", "social_media", "address_history"]) assert.equal(question(name).required, true, name);
  for (const name of ["other_names", "secondary_phone", "work_phone", "us_phone", "previous_spouse_count", "petitioner_mobile"]) assert.equal(question(name).required, false, name);
});

test("every table is a repeating group the client can keep adding to", () => {
  const groups = ["address_history", "other_phones", "other_emails", "social_media", "previous_spouses", "children", "us_visits", "other_occupations", "employment_history", "education_history", "countries_traveled"];
  for (const name of groups) {
    const item = question(name);
    assert.equal(item.type, "repeating_group", name);
    assert.equal(item.repeatable, true, name);
    assert.equal(item.repeatableConfig.allowClientAdd, true, name);
    assert.ok(item.metadata.addLabel && item.metadata.fields.length >= 1, `${name} has an Add action and columns`);
    assert.equal(item.repeatableConfig.max, name === "us_visits" ? 5 : undefined, `${name}: only the "last five visits" table is capped`);
  }
  assert.equal(question("address_history").metadata.fields.length, 8);
  assert.equal(question("children").metadata.fields.length, 7);
  const socialMedia = question("social_media").metadata.fields;
  assert.ok(socialMedia[0].options.some((option) => option.value === "None" || option === "None"), "None can be chosen when there is no social media");
});

// ── end to end, against the real pipeline ────────────────────────────────
test("workflow: provisioned with no forms -> CM draft -> approval releases it to the client -> answers sync to Admin", { timeout: 300000 }, async (t) => {
  const mongoose = require("mongoose");
  const connectDB = require("../../../config/database");
  await connectDB();
  const models = (name) => require(`../../../models/${name}`);
  const Case = models("Case");
  const User = models("User");
  const tag = `ZZ-TMP-GCNVC-${Date.now()}`;
  const admin = { _id: new mongoose.Types.ObjectId(), role: "super_admin", email: `${tag}-admin@e2e-audit.invalid` };
  const client = await User.create({ email: `${tag}@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp", role: "client" });
  const created = await Case.create({ caseNumber: tag, clientName: "Tmp GC-NVC", clientEmail: client.email, user: client._id, visaType: "GC-NVC", visaCategory: "GC-NVC", caseType: "immigration", caseStructure: "single", caseRole: "single", status: "active" });
  const req = { requestId: tag, ip: "127.0.0.1", headers: {} };
  const clientUser = { _id: client._id, role: "client", email: client.email };
  const manager = { _id: admin._id, role: "super_admin", email: admin.email };
  t.after(async () => {
    for (const name of ["Answer", "CaseForm", "Notification", "AuditLog", "Document"]) await models(name).deleteMany({ caseId: created._id }).catch(() => {});
    await Case.deleteMany({ _id: created._id });
    await User.deleteMany({ _id: client._id });
    await mongoose.disconnect();
  });

  const service = require("../questionnaire.service");
  const caseChecklist = require("../case-checklist.service");
  const orchestrator = require("../../cases/case-lifecycle-orchestrator.service");
  const checklistId = "gc_nvc_checklist|client";

  // 1+2+3: created through the real lifecycle - only the GC-NVC checklist, zero forms
  assert.equal(created.checklistApproval.required, true, "a new case starts gated");
  await orchestrator.initializeCase(created, manager, req);
  assert.equal(await models("CaseForm").countDocuments({ caseId: created._id }), 0, "no CaseForm records");
  const afterCreate = await Case.findById(created._id).lean();
  assert.equal((afterCreate.forms || afterCreate.uscisForms || []).length, 0, "no embedded forms");
  const staffList = await service.listCaseChecklists(created._id, manager);
  assert.deepEqual(staffList.checklists.map((item) => item.questionnaire?.key || item.key), ["gc_nvc_checklist"], "only the GC-NVC checklist is provisioned");

  // 4: Case Manager side first - the client sees nothing and cannot answer
  assert.equal((await service.listCaseChecklists(created._id, clientUser)).checklists.length, 0, "not released to the client yet");
  await assert.rejects(() => service.getQuestionnaireForCase(created._id, clientUser, "client"), /preparing this checklist/);

  // 5: approval releases it to the client
  const approval = await caseChecklist.approveChecklists(created._id, { checklistIds: [checklistId] }, manager, req);
  assert.equal(approval.approved.length, 1);
  assert.equal((await service.listCaseChecklists(created._id, clientUser)).checklists.length, 1, "the client now sees it");

  // 6+8+9: the client answers (a conditional block opens, a repeating group persists) and saves
  const loaded = await service.getQuestionnaireForCase(created._id, clientUser, "client");
  const visibleKeys = () => new Set(loaded.questions.map((item) => item.key));
  assert.ok(visibleKeys().has("gc_nvc_has_children"));
  assert.ok(!visibleKeys().has("gc_nvc_children"), "child records hidden until 'Do you have children' = Yes");
  const children = [
    { last_name: "Rao", first_name: "Asha", date_of_birth: "2015-04-02", birth_place: "Pune, Maharashtra, India", present_address: "1 Main St, Pune", immigrating_with_you: "Yes", immigrating_later: "No" },
    { last_name: "Rao", first_name: "Dev", date_of_birth: "2018-09-12", birth_place: "Pune, Maharashtra, India", present_address: "1 Main St, Pune", immigrating_with_you: "No", immigrating_later: "Yes" },
  ];
  const save = (answers) => service.saveAnswers({ questionnaireId: loaded.questionnaire._id, caseId: String(created._id), responseId: loaded.responseId, targetRole: "client", answers }, clientUser, req);
  await save([
    { questionKey: "gc_nvc_first_name", value: "Meera" },
    { questionKey: "gc_nvc_last_name", value: "Rao" },
    { questionKey: "gc_nvc_has_children", value: "Yes" },
    { questionKey: "gc_nvc_children_count", value: 2 },
    { questionKey: "gc_nvc_children", value: children },
  ]);

  // 7: Admin / Case Manager reads the same saved answers
  const adminView = await service.getQuestionnaireForCase(created._id, manager, "client");
  const answer = (name) => adminView.answers.find((item) => item.questionKey === `gc_nvc_${name}`);
  assert.equal(answer("first_name").value, "Meera");
  assert.equal(answer("has_children").value, "Yes");
  assert.equal(answer("children").value.length, 2, "both child records persisted");
  assert.equal(answer("children").value[1].first_name, "Dev");
  assert.ok(adminView.questions.some((item) => item.key === "gc_nvc_children"), "child records are visible once the answer is Yes");
  assert.equal(await models("CaseForm").countDocuments({ caseId: created._id }), 0, "still no forms after answers are saved");
});

test("PERM still provisions no USCIS forms", async () => {
  const mongoose = require("mongoose");
  const connectDB = require("../../../config/database");
  await connectDB();
  try {
    const { resolveVisaFormMappings } = require("../../form-registry/visaFormMapping.service");
    for (const visaType of ["PERM", "GC-NVC"]) {
      const resolved = await resolveVisaFormMappings({ visaType, visaCategory: visaType, caseStructure: visaType === "PERM" ? "employer_employee" : "single", caseRole: visaType === "PERM" ? "principal" : "single" });
      const total = [...resolved.autoCreate, ...resolved.conditional, ...resolved.laterStage, ...resolved.reference].length;
      assert.equal(total, 0, `${visaType} resolves no form mappings`);
    }
  } finally {
    await mongoose.disconnect();
  }
});
