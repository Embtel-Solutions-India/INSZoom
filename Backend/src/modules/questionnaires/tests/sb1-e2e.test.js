// SB-1 (Returning Resident) end to end against the REAL configured database. Same harness and cleanup discipline as gcNvcChecklist.test.js:
// every record the test creates is deleted afterwards.
const assert = require("node:assert/strict");
const test = require("node:test");

test("SB-1: single-person provisioning (idempotent, no subcases), approval gate, persistence, canonical values, staff read, access control", { timeout: 600000 }, async (t) => {
  const mongoose = require("mongoose");
  const connectDB = require("../../../config/database");
  await connectDB();
  const models = (name) => require(`../../../models/${name}`);
  const Case = models("Case");
  const User = models("User");
  const CaseForm = models("CaseForm");
  const tag = `ZZ-TMP-SB1-${Date.now()}`;
  const admin = { _id: new mongoose.Types.ObjectId(), role: "super_admin", email: `${tag}-admin@e2e-audit.invalid` };
  const client = await User.create({ email: `${tag}@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp", role: "client" });
  const stranger = await User.create({ email: `${tag}-other@e2e-audit.invalid`, password: "Tmp!Passw0rd123", name: "tmp2", role: "client" });
  const created = await Case.create({ caseNumber: tag, clientName: "Tmp SB1", clientEmail: client.email, user: client._id, visaType: "SB-1", visaCategory: "SB-1", caseType: "immigration", caseStructure: "single", caseRole: "single", status: "active" });
  const req = { requestId: tag, ip: "127.0.0.1", headers: {} };
  const clientUser = { _id: client._id, role: "client", email: client.email };
  const strangerUser = { _id: stranger._id, role: "client", email: stranger.email };
  const manager = { _id: admin._id, role: "super_admin", email: admin.email };
  t.after(async () => {
    for (const name of ["Answer", "CaseForm", "Notification", "AuditLog", "Document"]) await models(name).deleteMany({ caseId: created._id }).catch(() => {});
    await Case.deleteMany({ $or: [{ _id: created._id }, { parentCase: created._id }] });
    await User.deleteMany({ _id: { $in: [client._id, stranger._id] } });
    await mongoose.disconnect();
  });

  const service = require("../questionnaire.service");
  const caseChecklist = require("../case-checklist.service");
  const orchestrator = require("../../cases/case-lifecycle-orchestrator.service");

  // 1. provisioning through the shared lifecycle, twice: one checklist reference, no subcases, none of the family / employer machinery
  await orchestrator.initializeCase(created, manager, req);
  await orchestrator.initializeCase(await Case.findById(created._id), manager, req);
  const afterInit = await Case.findById(created._id).lean();
  assert.equal(afterInit.caseStructure, "single");
  assert.equal((afterInit.childCases || []).length, 0, "no automatic subcases");
  assert.equal(await Case.countDocuments({ parentCase: created._id }), 0);
  assert.ok(!afterInit.petitionerUser && !afterInit.employerUser && !afterInit.beneficiaryUser, "no petitioner / employer / beneficiary");
  assert.equal(afterInit.questionnaireReferences.filter((reference) => reference.active !== false).length, 1, "one questionnaire reference after two initialisations");
  const formCodes = (await CaseForm.find({ caseId: created._id }).select("formCode").lean()).map((form) => form.formCode);
  ["I-130", "I-485", "I-129", "I-140", "DS-260"].forEach((code) => assert.ok(!formCodes.includes(code), `${code} is not provisioned for SB-1`));
  const staffList = await service.listCaseChecklists(created._id, manager);
  assert.deepEqual(staffList.checklists.map((item) => item.questionnaire?.key || item.key), ["sb1_returning_resident_document_checklist"]);

  // 2. approval gate, then client access; another client is refused
  assert.equal((await service.listCaseChecklists(created._id, clientUser)).checklists.length, 0);
  await caseChecklist.approveChecklists(created._id, { checklistIds: ["sb1_returning_resident_document_checklist|client"] }, manager, req);
  assert.equal((await service.listCaseChecklists(created._id, clientUser)).checklists.length, 1);
  await assert.rejects(() => service.getQuestionnaireForCase(created._id, strangerUser, "client"), /not authorized|forbidden|access/i);

  // 3. the client saves a partial draft (all optional), including conditional answers and repeatable tables
  const loaded = await service.getQuestionnaireForCase(created._id, clientUser, "client");
  assert.equal(loaded.questionnaire.title, "SB-1 Visa Questionnaire");
  const hidden = (key) => assert.ok(!loaded.questions.some((item) => item.key === key), `${key} hidden at first`);
  hidden("client_spouseFirstName"); hidden("client_foreignEmployment");
  const save = (answers) => service.saveAnswers({ questionnaireId: loaded.questionnaire._id, caseId: String(created._id), responseId: loaded.responseId, targetRole: "client", answers }, clientUser, req);
  const A = (questionKey, value) => ({ questionKey, value });
  const periods = [{ fromDate: "2019-01-10", toDate: "2020-03-01", country: "India" }, { fromDate: "2021-02-01", toDate: "2022-08-15", country: "India" }, { fromDate: "2023-01-01", toDate: "2023-12-31", country: "Nepal" }];
  const family = [{ fullName: "Asha Rao", relationship: "Child", usResidenceStatus: "U.S. Citizen", addressLine1: "1 Main St", addressCity: "Austin", addressState: "TX", addressPostalCode: "73301", addressCountry: "United States" }];
  await save([
    A("client_firstName", "meera"), A("client_lastName", "Rao"), A("client_dateOfBirth", "1975-02-03"), A("client_placeOfBirthCountry", "India"),
    A("client_currentHomeAddressLine1", "5 Park Road"), A("client_currentHomeAddressCity", "Pune"), A("client_currentHomeAddressCountry", "India"),
    A("client_telephoneNumber", "+91 98765 43210"), A("client_otherNamesUsed", [{ name: "Meera Kumar" }]),
    A("client_maritalStatus", "Married"), A("client_spouseFirstName", "Dev"), A("client_spouseLastName", "Rao"), A("client_dateOfMarriage", "2000-05-06"),
    A("client_closeFamilyMembers", family), A("client_aNumber", "A-123456789"),
    A("client_initialLprEntryDate", "2010-06-01"), A("client_lastLprEntryDate", "2018-07-01"), A("client_mostRecentDepartureDate", "2019-01-10"),
    A("client_continuingUSTies", "I kept my house and bank accounts."), A("client_reasonForNotReturning", "Medical treatment abroad."),
    A("client_periodsOutsideUs", periods), A("client_employedOutsideUs", "Yes"),
    A("client_foreignEmployment", [{ employerName: "Acme Pune", addressCity: "Pune", addressCountry: "India", fromDate: "2019-02-01", toDate: "2022-01-01" }]),
  ]);

  // 4. staff read the same persisted answers (a table keeps all rows, including more than six)
  const staffView = await service.getQuestionnaireForCase(created._id, manager, "client");
  const answer = (key) => staffView.answers.find((item) => item.questionKey === key);
  assert.equal(answer("client_maritalStatus").value, "Married");
  assert.equal(answer("client_periodsOutsideUs").value.length, 3);
  assert.equal(answer("client_closeFamilyMembers").value[0].fullName, "Asha Rao");
  assert.ok(staffView.questions.some((item) => item.key === "client_spouseFirstName"), "spouse questions visible once Married");
  // the client's own view carries no staff-only material
  const ownView = await service.getQuestionnaireForCase(created._id, clientUser, "client");
  assert.ok(!JSON.stringify(ownView).includes("canonicalProfile"), "no internal canonical data in the client payload");

  // 5. canonical profile: reused paths for known facts, new paths for the rest, provenance from the questionnaire answer; no spouse participant
  await require("../../canonical/services/CanonicalSyncService").syncCase(created._id, manager, req, "sb1-e2e");
  const fresh = await Case.findById(created._id).lean();
  const profile = fresh.canonicalProfile.profile;
  assert.equal(profile.person.firstName, "Meera");
  assert.equal(profile.person.dob, "1975-02-03");
  assert.equal(profile.person.alienNumber, "A123456789");
  assert.equal(profile.person.maritalStatus, "Married");
  assert.equal(profile.contact.address.line1, "5 Park Road");
  assert.equal(profile.family.spouse.firstName, "Dev");
  assert.equal(profile.immigration.permanentResidentHistory.initialEntry.date, "2010-06-01");
  assert.equal(profile.immigration.permanentResidentHistory.lastEntry.date, "2018-07-01");
  assert.equal(profile.immigration.permanentResidentHistory.mostRecentDeparture.date, "2019-01-10");
  assert.equal(profile.immigration.returningResident.reasonsForDelayedReturn, "Medical treatment abroad.");
  assert.equal(profile.immigration.residenceAbroadPeriods.length, 3);
  assert.equal(profile.familyMembersInUS[0].relationship, "Child");
  assert.equal(profile.immigration.returningResident.employmentOutsideUS.sinceMostRecentDeparture, "Yes");
  assert.equal(profile.immigration.returningResident.employmentOutsideUS.records.length, 1);
  const provenance = fresh.canonicalProfile.fieldMetadata["person.firstName"];
  assert.equal(provenance.sourceType, "questionnaire");
  assert.equal(provenance.sourceField, "client_firstName");
  assert.ok(provenance.sourceId);
  assert.equal(await Case.countDocuments({ parentCase: created._id }), 0, "answering 'Married' / 'employed abroad' created no spouse or employer case");

  // 6. changing a gate keeps the earlier answers (retention), the conditional questions simply stop showing
  await save([A("client_maritalStatus", "Single")]);
  const afterChange = await service.getQuestionnaireForCase(created._id, manager, "client");
  assert.ok(!afterChange.questions.some((item) => item.key === "client_spouseFirstName"));
  assert.equal(afterChange.answers.find((item) => item.questionKey === "client_spouseFirstName").value, "Dev", "the earlier spouse answer is retained");
});
