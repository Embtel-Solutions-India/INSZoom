// Form I-907 (Premium Processing) checklist end to end against the REAL configured database. Same harness and cleanup discipline as
// gcNvcChecklist.test.js: every record the test creates is deleted afterwards.
const assert = require("node:assert/strict");
const test = require("node:test");

test("I-907: one active checklist, provisioning, submit rules with optional questions, canonical values, manual edits, and the PDF still fills", { timeout: 600000 }, async (t) => {
  const mongoose = require("mongoose");
  const connectDB = require("../../../config/database");
  await connectDB();
  const models = (name) => require(`../../../models/${name}`);
  const Case = models("Case");
  const User = models("User");
  const CaseForm = models("CaseForm");
  const tag = `ZZ-TMP-I907-${Date.now()}`;
  const admin = { _id: new mongoose.Types.ObjectId(), role: "super_admin", email: `${tag}-admin@e2e-audit.invalid` };
  const client = await User.create({ email: `${tag}@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp", role: "client" });
  const created = await Case.create({ caseNumber: tag, clientName: "Tmp I907", clientEmail: client.email, user: client._id, visaType: "Premium Processing", visaCategory: "Premium Processing", caseType: "immigration", caseStructure: "single", caseRole: "single", status: "active" });
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
  const { PREMIUM_PROCESSING_DEFINITIONS } = require("../premiumProcessingChecklist");
  const definition = PREMIUM_PROCESSING_DEFINITIONS[0];
  const Questionnaire = models("Questionnaire");
  const Question = models("Question");

  // 1. provisioning (twice): one checklist reference, Form I-907 only; the template is reconciled to the new definition in place
  await orchestrator.initializeCase(created, manager, req);
  await orchestrator.initializeCase(await Case.findById(created._id), manager, req);
  assert.deepEqual((await CaseForm.find({ caseId: created._id }).select("formCode").lean()).map((form) => form.formCode), ["I-907"]);
  assert.equal((await Case.findById(created._id).lean()).questionnaireReferences.filter((reference) => reference.active !== false).length, 1);

  // 2. exactly ONE I-907 questionnaire is current, its title / sections / questions are the new ones; the old questions are retired, not deleted
  await service.ensureTemplate(definition.key, undefined, undefined, { wait: true });
  const stored = await Questionnaire.find({ key: definition.key, latestVersion: true }).lean();
  assert.equal(stored.length, 1, "one current I-907 questionnaire");
  assert.equal(await Questionnaire.countDocuments({ key: /^i907/, latestVersion: true }), 1, "no second I-907 questionnaire exists");
  assert.deepEqual(stored[0].sections.map((section) => section.title), definition.sections);
  const active = (await Question.find({ questionnaire: stored[0]._id, active: true }).select("key").lean()).map((question) => question.key).sort();
  assert.deepEqual(active, definition.questions.map((question) => question.key).sort(), "the active questions are exactly the new definition");
  assert.ok(await Question.countDocuments({ questionnaire: stored[0]._id, active: false }) > 0, "retired questions are kept (history), not deleted");

  // 3. approval gate, then the client loads the new checklist: exact labels, the receipt-notice document, beneficiary hidden until the form is known
  await caseChecklist.approveChecklists(created._id, { checklistIds: [`${definition.key}|client`] }, manager, req);
  const loaded = await service.getQuestionnaireForCase(created._id, clientUser, "client");
  assert.equal(loaded.questionnaire.title, "Form I-907 Information Checklist");
  const shown = (key) => loaded.questions.some((question) => question.key === key);
  assert.ok(shown("i907_filer_last_name") && shown("i907_doc_relatedCaseReceiptNotice"));
  assert.ok(!shown("i907_beneficiary_last_name") && !shown("i907_company_poc_last_name") && !shown("i907_physical_address_street"));
  assert.equal(loaded.questions.find((question) => question.key === "i907_petitioner_last_name").label, "Petitioner or Applicant — Family Name (Last Name)");

  // 4. the client answers (optional questions left blank) and saves
  const save = (answers, user = clientUser) => service.saveAnswers({ questionnaireId: loaded.questionnaire._id, caseId: String(created._id), responseId: loaded.responseId, targetRole: "client", answers }, user, req);
  const A = (questionKey, value) => ({ questionKey, value });
  await save([
    A("i907_filer_last_name", "Testcase"), A("i907_filer_first_name", "Ivy"),
    A("i907_mailing_address_street", "12 Test Street"), A("i907_mailing_address_city", "Austin"), A("i907_mailing_address_country", "United States"),
    A("i907_mailing_address_state", "TX"), A("i907_mailing_address_zip_code", "73301"), A("i907_address_same_as_physical", "Yes"),
    A("i907_related_case_form_number", "I-129"), A("i907_related_case_receipt_number", "EAC1234567890"),
    A("i907_petitioner_last_name", "Acme"), A("i907_petitioner_first_name", "Corp"), A("i907_beneficiary_last_name", "Rao"), A("i907_beneficiary_first_name", "Dev"),
  ]);

  // 5. Submit: optional questions (A-Number, apt, EIN, second receipt ...) do not block it; only the receipt notice is still owed
  const incomplete = await service.submitResponse({ questionnaireId: loaded.questionnaire._id, caseId: String(created._id), responseId: loaded.responseId, targetRole: "client", answers: [] }, clientUser, req).then(() => null, (error) => error);
  assert.equal(incomplete.code, "CHECKLIST_INCOMPLETE");
  assert.deepEqual(incomplete.details.missing.map((item) => item.questionKey), ["i907_doc_relatedCaseReceiptNotice"], "everything else, optional ones included, is satisfied");
  // a physical address that DOES differ becomes owed, and the optional province / apt still are not
  await save([A("i907_address_same_as_physical", "No")]);
  const differs = await service.submitResponse({ questionnaireId: loaded.questionnaire._id, caseId: String(created._id), responseId: loaded.responseId, targetRole: "client", answers: [] }, clientUser, req).then(() => null, (error) => error);
  assert.ok(differs.details.missing.map((item) => item.questionKey).includes("i907_physical_address_street"));
  assert.ok(!differs.details.missing.map((item) => item.questionKey).includes("i907_physical_address_unit"));
  await save([A("i907_address_same_as_physical", "Yes")]); // switching back keeps nothing owed

  // 6. canonical profile: requestFiler.* / premiumProcessing.*, array path for the receipt number, provenance; the case's own person.* is untouched
  await save([A("i907_filer_alien_registration_number", "A-123456789")]);
  await require("../../canonical/services/CanonicalSyncService").syncCase(created._id, manager, req, "i907-e2e");
  const fresh = await Case.findById(created._id).lean();
  const profile = fresh.canonicalProfile.profile;
  assert.equal(profile.requestFiler.lastName, "Testcase");
  assert.equal(profile.requestFiler.mailingAddress.state, "TX");
  assert.equal(profile.requestFiler.physicalAddress.sameAsMailingAddress, "Yes");
  assert.equal(profile.premiumProcessing.relatedCase.formNumber, "I-129");
  assert.equal(profile.premiumProcessing.relatedCase.receiptNumbers[0], "EAC1234567890");
  assert.equal(profile.premiumProcessing.relatedCase.beneficiary.firstName, "Dev");
  assert.ok(!profile.person?.alienNumber, "the filer's A-Number never lands on person.*");
  assert.equal(fresh.canonicalProfile.fieldMetadata["requestFiler.lastName"].sourceField, "i907_filer_last_name");

  // 7. a staff edit is kept when the client saves something else afterwards (manual change is never silently overwritten)
  await save([A("i907_petitioner_last_name", "Acme Holdings")], manager);
  await save([A("i907_filer_first_name", "Ivana")]);
  const staffView = await service.getQuestionnaireForCase(created._id, manager, "client");
  assert.equal(staffView.answers.find((item) => item.questionKey === "i907_petitioner_last_name").value, "Acme Holdings");
  assert.equal(staffView.answers.find((item) => item.questionKey === "i907_filer_first_name").value, "Ivana");

  // 8. the I-907 PDF mapping (reads the same question keys, unchanged) still fills the form
  const AutoFill = require("../../form-mapping/services/AutoFillService");
  let caseForm;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { ({ caseForm } = await AutoFill.generate(created._id, "I-907", manager, req, { regenerate: true })); break; } catch (error) {
      if (error.name !== "VersionError" || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
  }
  const MappingResolver = require("../../form-mapping/services/MappingResolver");
  const template = await models("USCISFormTemplate").findById(caseForm.formTemplateId).lean();
  const ids = new Map(template.formFields.map((field) => [field.fieldName.replace(/form1\[0\]\.#subform\[\d+\]\./, ""), field.fieldId]));
  const printed = (name) => MappingResolver.resolvePath(caseForm.filledData, ids.get(name));
  assert.equal(printed("Pt1Line3_FamilyName[0]"), "Testcase");
  assert.equal(printed("Pt1Line3_GivenName[0]"), "Ivana");
  assert.equal(printed("P2_Line2_ReceiptNumberof[0]"), "EAC1234567890");
  assert.equal(printed("Part2_Line4_PetitionerApplicantFamilyName[0]"), "Acme Holdings");
  assert.equal(printed("Part1_Line7_PhysicalAddress_StreetNumberName[0]"), undefined, "same address: no separate physical address printed");
});
