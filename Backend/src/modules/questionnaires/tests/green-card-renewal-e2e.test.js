// Form I-90 (Green Card Renewal) end to end, against the REAL configured database (the I-90 template, its mapping graph and the checklist
// definition live there). Same harness and cleanup discipline as gcNvcChecklist.test.js: every record the test creates is deleted afterwards.
const assert = require("node:assert/strict");
const test = require("node:test");

test("Green Card Renewal: provisioning, approval gate, persistence, access control, strict submit, canonical -> official I-90 fields", { timeout: 600000 }, async (t) => {
  const mongoose = require("mongoose");
  const connectDB = require("../../../config/database");
  await connectDB();
  const models = (name) => require(`../../../models/${name}`);
  const Case = models("Case");
  const User = models("User");
  const CaseForm = models("CaseForm");
  const tag = `ZZ-TMP-I90-${Date.now()}`;
  const admin = { _id: new mongoose.Types.ObjectId(), role: "super_admin", email: `${tag}-admin@e2e-audit.invalid` };
  const client = await User.create({ email: `${tag}@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp", role: "client" });
  const stranger = await User.create({ email: `${tag}-other@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp2", role: "client" });
  const created = await Case.create({ caseNumber: tag, clientName: "Tmp I90", clientEmail: client.email, user: client._id, visaType: "Green Card Renewal", visaCategory: "Green Card Renewal", caseType: "immigration", caseStructure: "single", caseRole: "single", status: "active" });
  const req = { requestId: tag, ip: "127.0.0.1", headers: {} };
  const clientUser = { _id: client._id, role: "client", email: client.email };
  const strangerUser = { _id: stranger._id, role: "client", email: stranger.email };
  const manager = { _id: admin._id, role: "super_admin", email: admin.email };
  t.after(async () => {
    for (const name of ["Answer", "CaseForm", "Notification", "AuditLog", "Document"]) await models(name).deleteMany({ caseId: created._id }).catch(() => {});
    await Case.deleteMany({ _id: created._id });
    await User.deleteMany({ _id: { $in: [client._id, stranger._id] } });
    await mongoose.disconnect();
  });

  const service = require("../questionnaire.service");
  const caseChecklist = require("../case-checklist.service");
  const orchestrator = require("../../cases/case-lifecycle-orchestrator.service");
  const checklistId = "green_card_renewal_checklist|client";

  // 1. provisioning: the one checklist and ONLY Form I-90; idempotent
  assert.equal(created.checklistApproval.required, true, "a new case starts gated");
  await orchestrator.initializeCase(created, manager, req);
  await orchestrator.initializeCase(await Case.findById(created._id), manager, req);
  assert.deepEqual((await CaseForm.find({ caseId: created._id }).select("formCode").lean()).map((form) => form.formCode), ["I-90"], "exactly one I-90, no I-130 / I-485 / I-864 / I-751, no duplicate after re-initialisation");
  const staffList = await service.listCaseChecklists(created._id, manager);
  assert.deepEqual(staffList.checklists.map((item) => item.questionnaire?.key || item.key), ["green_card_renewal_checklist"]);
  assert.equal((await Case.findById(created._id).lean()).questionnaireReferences.filter((reference) => reference.active !== false).length, 1, "one reference, not two");

  // 2. approval gate: hidden from the client until the case manager approves
  assert.equal((await service.listCaseChecklists(created._id, clientUser)).checklists.length, 0);
  await assert.rejects(() => service.getQuestionnaireForCase(created._id, clientUser, "client"), /preparing this checklist|not been released/i);
  await caseChecklist.approveChecklists(created._id, { checklistIds: [checklistId] }, manager, req);
  assert.equal((await service.listCaseChecklists(created._id, clientUser)).checklists.length, 1);

  // 3. another client cannot read or write this case
  await assert.rejects(() => service.getQuestionnaireForCase(created._id, strangerUser, "client"), /not authorized|forbidden|access/i);

  // 4. the client answers and saves a draft (nothing is required to save); the case manager reads the same persisted answers
  const loaded = await service.getQuestionnaireForCase(created._id, clientUser, "client");
  assert.equal(loaded.questionnaire.title, "Questionnaire for Form I-90 — Application to Replace Permanent Resident Card");
  const save = (answers) => service.saveAnswers({ questionnaireId: loaded.questionnaire._id, caseId: String(created._id), responseId: loaded.responseId, targetRole: "client", answers }, clientUser, req);
  const A = (questionKey, value) => ({ questionKey, value });
  await save([A("i90_applicationReason", "replacement"), A("i90_replacementCircumstance", "lost")]);
  const draft = await service.getQuestionnaireForCase(created._id, manager, "client");
  assert.equal(draft.answers.find((item) => item.questionKey === "i90_replacementCircumstance").value, "lost");

  // 5. strict submit guard: incomplete, then invalid, are refused with a clear reason; complete + valid passes
  const strictCheck = async () => service.assertStrictChecklistsSubmittable({ questionnaireReferences: (await Case.findById(created._id).lean()).questionnaireReferences }, clientUser).then(() => null, (error) => error);
  const early = await strictCheck();
  assert.equal(early.code, "CHECKLIST_INCOMPLETE");
  assert.equal(early.status, 422);

  const everything = [
    A("i90_applicationReason", "replacement"), A("i90_residentStatusType", "lawful_permanent_resident"), A("i90_replacementCircumstance", "lost"),
    A("i90_incidentDate", "2025-11-03"), A("i90_incidentDescription", "Lost during a move."),
    A("i90_aNumber", "A-123456789"), A("i90_hasUscisOnlineAccount", "no"), A("i90_hasSsn", "yes"), A("i90_ssn", "123-45-6789"),
    A("i90_lastName", "Testcase"), A("i90_firstName", "ivy"), A("i90_hasMiddleName", "no"), A("i90_nameChangedSinceCardIssued", "no"),
    A("i90_sex", "Female"), A("i90_dateOfBirth", "1990-04-05"), A("i90_cityOfBirth", "Pune"), A("i90_countryOfBirth", "India"),
    A("i90_motherGivenName", "Asha"), A("i90_fatherGivenName", "Ravi"), A("i90_ethnicity", "not_hispanic_or_latino"), A("i90_race", ["asian"]),
    A("i90_heightFeet", 5), A("i90_heightInches", 6), A("i90_weightPounds", 95), A("i90_eyeColor", "brown"), A("i90_hairColor", "black"),
    A("i90_mailingStreet", "12 Test Street"), A("i90_mailingUnitType", "none"), A("i90_mailingCity", "Austin"), A("i90_mailingCountry", "United States"), A("i90_mailingState", "TX"), A("i90_mailingZip", "73301"),
    A("i90_physicalAddressDifferent", "no"), A("i90_daytimePhone", "5125550100"), A("i90_emailAddress", "Ivy.Test@Example.com"),
    A("i90_classOfAdmission", "ir1"), A("i90_dateOfAdmission", "2018-06-15"), A("i90_greenCardPath", "adjustment_of_status"),
    A("i90_locationAppliedForVisa", "Houston, TX"), A("i90_locationVisaIssued", "Houston, TX"),
    A("i90_removalProceedings", "no"), A("i90_abandonmentDetermination", "no"), A("i90_accommodationRequested", "no"),
    A("i90_hasPreviousCard", "no"), A("i90_hasStateIdentification", "no"),
  ];
  await save(everything.filter((item) => item.questionKey !== "i90_ssn"));
  // every visible question except the SSN and the file uploads is answered, so the only blanks left are those
  const blank = await strictCheck();
  assert.equal(blank.code, "CHECKLIST_INCOMPLETE");
  const missingKeys = blank.details.missing.map((item) => item.questionKey);
  assert.ok(missingKeys.includes("i90_ssn") && missingKeys.includes("i90_doc_passport"), "the missing SSN and the passport are named");

  await save([A("i90_ssn", "12345")]);
  const invalid = await strictCheck();
  assert.ok(invalid, "a malformed SSN is refused");
  await save([A("i90_ssn", "123-45-6789")]);

  // 6. canonical profile: bound answers land at their canonical paths with provenance attributed to the questionnaire answer
  await require("../../canonical/services/CanonicalSyncService").syncCase(created._id, manager, req, "i90-e2e");
  const fresh = await Case.findById(created._id).lean();
  assert.equal(fresh.canonicalProfile.profile.person.alienNumber, "A123456789");
  assert.equal(fresh.canonicalProfile.profile.person.gender, "female");
  assert.equal(fresh.canonicalProfile.profile.immigration.greenCard.applicationReason, "replacement");
  const provenance = fresh.canonicalProfile.fieldMetadata["person.lastName"];
  assert.equal(provenance.sourceType, "questionnaire");
  assert.equal(provenance.sourceField, "i90_lastName");
  assert.ok(provenance.sourceId && provenance.collectedAt);

  // 7. official I-90 fields filled from the canonical profile (retry: the sync above also triggers a background autofill of the same form)
  const AutoFill = require("../../form-mapping/services/AutoFillService");
  let caseForm;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { ({ caseForm } = await AutoFill.generate(created._id, "I-90", manager, req, { regenerate: true })); break; } catch (error) {
      if (error.name !== "VersionError" || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
  }
  const MappingResolver = require("../../form-mapping/services/MappingResolver");
  const template = await models("USCISFormTemplate").findById(caseForm.formTemplateId).lean();
  const ids = new Map(template.formFields.map((field) => [field.fieldName.replace(/form1\[0\]\.#subform\[\d+\]\./, ""), field.fieldId]));
  const printed = (name) => MappingResolver.resolvePath(caseForm.filledData, ids.get(name));
  assert.equal(printed("P1_Line3a_FamilyName[0]"), "Testcase");
  assert.equal(printed("P1_Line3b_GivenName[0]"), "Ivy");
  assert.equal(printed("#area[1].P1_Line1_AlienNumber[0]"), "123456789");
  assert.equal(printed("P1_Line9_DateOfBirth[0]"), "04/05/1990");
  assert.equal(printed("P2_checkbox2[5]"), true, "reason 2.a (lost) is ticked");
  assert.notEqual(printed("P2_checkbox2[1]"), true, "renewal 2.f is not");
  assert.equal(printed("P2_checkbox1[0]"), true);
  assert.equal(printed("P1_Line16_SSN[0]"), "123456789");
  assert.equal(printed("P1_Line3c_MiddleName[0]"), undefined, "no middle name was given");
  assert.equal(printed("P1_Line7a_StreetNumberName[0]"), undefined, "no physical address was given");
  assert.equal(printed("P3_Line3a1_CityandState[0]"), undefined, "adjustment-of-status case: no port of entry");

  // 8. the persisted mapping graph is the reviewed crosswalk: canonical sources only, every target a real template field
  const MappingGraphService = require("../../form-mapping/services/MappingGraphService");
  const { MAPPED_EDGES } = require("../../form-mapping/config/i90-crosswalk");
  const graph = await MappingGraphService.loadCurrentGraph(template);
  assert.equal(graph.edges.length, MAPPED_EDGES.length, "re-run `npm run seed:i90-mapping` if the crosswalk changed");
  graph.edges.forEach((edge) => assert.match(edge.sourcePath, /^(person|contact|immigration)\./));
  const fieldNames = new Set(template.formFields.map((field) => field.fieldName));
  MAPPED_EDGES.forEach((edge) => assert.ok(fieldNames.has(edge.fieldName), `${edge.fieldName} exists in the I-90 template (edition ${template.editionDate?.toISOString?.().slice(0, 10)})`));
  // the Part 2 reason boxes sit top-to-bottom in the order the crosswalk assumes (guards against a new form edition re-ordering them)
  const reasonWidgets = template.formFields
    .filter((field) => /P2_checkbox2\[/.test(field.fieldName))
    .map((field) => ({ index: Number(/\[(\d+)\]$/.exec(field.fieldName)[1]), y: field.widgets[0].y }))
    .sort((a, b) => b.y - a.y).map((item) => item.index);
  assert.deepEqual(reasonWidgets, [5, 6, 7, 4, 0, 1, 2, 3, 11, 9, 10, 8]);

  // 9. traceability: every mapped field is fed by a checklist question
  const trace = await require("../../form-mapping/services/ChecklistFieldTraceabilityService").coverageSummary(template._id);
  assert.equal(trace.tracedToChecklistQuestion, trace.totalMappedFields);
  assert.equal(trace.mappedWithNoChecklistQuestion, 0);
});
