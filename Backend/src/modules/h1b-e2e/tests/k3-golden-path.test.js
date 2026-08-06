// K-3 golden-path e2e test, mirroring k1-golden-path.test.js's structure
// exactly (S1-S6), targeting I-130 instead of I-129F.
//
// NOTE: written and reviewed against the real k3.js/i130-k3-crosswalk.js
// source, but NOT executed in the authoring environment - no reachable
// MongoDB there (see l1a-golden-path.test.js's identical note). Run
// `npm run test:e2e` in an environment with DB access to verify.
const assert = require("node:assert/strict");
const test = require("node:test");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const { BASE, petitionerAnswers, beneficiaryAnswers } = require("../../../test-utils/fixtures/k3-golden");

const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const Answer = require("../../../models/Answer");
const AuditLog = require("../../../models/AuditLog");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const Questionnaire = require("../../../models/Questionnaire");
const User = require("../../../models/User");

const questionnaireService = require("../../questionnaires/questionnaire.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const MappingResolver = require("../../form-mapping/services/MappingResolver");

const CHECKLIST_DOCS = [
  { documentType: "petitioner_us_passport", title: "Petitioner Passport" },
  { documentType: "petitioner_i130_receipt_notice", title: "I-130 Receipt Notice" },
  { documentType: "beneficiary_passport_copy", title: "Beneficiary Passport" },
  { documentType: "beneficiary_national_identity_card", title: "Beneficiary National Identity Card" },
];

let caseId;
let petitionerUserId;
let beneficiaryUserId;
const req = { ip: "127.0.0.1", headers: {} };
const teamLead = () => ({ _id: petitionerUserId, role: "team_lead" });

test.before(async () => {
  await connectTestDB();
});

test.after(async () => {
  if (caseId) {
    await CaseForm.deleteMany({ caseId });
    await Document.deleteMany({ caseId });
    await Answer.deleteMany({ caseId });
    await AuditLog.deleteMany({ entityId: caseId.toString() }).catch(() => null);
    await Case.deleteOne({ _id: caseId });
  }
  if (petitionerUserId) await User.deleteOne({ _id: petitionerUserId });
  if (beneficiaryUserId) await User.deleteOne({ _id: beneficiaryUserId });
  await disconnectTestDB();
});

test("K-3 golden path: S1-S6 against the real pipeline", async () => {
  // --- S1: Case creation ---
  const petitionerUser = await User.create({ email: "marcus.alvarez.k3@example.com", password: "not-a-real-hash", name: `${BASE.petitioner.firstName} ${BASE.petitioner.lastName}`, role: "client" });
  petitionerUserId = petitionerUser._id;
  const beneficiaryUser = await User.create({ email: "camila.alvarez.k3@example.com", password: "not-a-real-hash", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "beneficiary" });
  beneficiaryUserId = beneficiaryUser._id;
  const caseDoc = await Case.create({
    caseNumber: BASE.caseNumber, visaType: BASE.visaType, caseType: "family",
    petitionerUser: petitionerUser._id, beneficiaryUser: beneficiaryUser._id, user: petitionerUser._id,
    status: "active",
  });
  caseId = caseDoc._id;
  assert.equal(caseDoc.visaType, "K-3");

  // --- S2: Questionnaire intake ---
  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const petitionerQ = await Questionnaire.findOne({ key: "k3_petitioner_checklist", latestVersion: true });
  const beneficiaryQ = await Questionnaire.findOne({ key: "k3_beneficiary_checklist", latestVersion: true });
  assert.ok(petitionerQ, "k3_petitioner_checklist must exist (built by familyChecklists.js)");
  assert.ok(beneficiaryQ, "k3_beneficiary_checklist must exist (built by familyChecklists.js)");
  await questionnaireService.saveAnswers({
    questionnaireId: petitionerQ._id,
    caseId,
    answers: Object.entries(petitionerAnswers()).map(([questionKey, value]) => ({ questionKey, value })),
  }, { _id: petitionerUserId, role: "client" }, req, "submitted");
  await questionnaireService.saveAnswers({
    questionnaireId: beneficiaryQ._id,
    caseId,
    answers: Object.entries(beneficiaryAnswers()).map(([questionKey, value]) => ({ questionKey, value })),
  }, { _id: beneficiaryUserId, role: "beneficiary" }, req, "submitted");
  const answerCount = await Answer.countDocuments({ caseId });
  assert.ok(answerCount > 6, "questionnaireData must be populated from this case's own answers");

  // --- S3: Document upload records ---
  for (const doc of CHECKLIST_DOCS) {
    await Document.create({
      user: petitionerUserId, caseId, category: "evidence", documentType: doc.documentType, reviewStatus: "approved",
      description: doc.title, originalName: `${doc.documentType}.pdf`, originalFileName: `${doc.documentType}.pdf`,
      storedName: `${doc.documentType}.pdf`, fileName: `${doc.documentType}.pdf`, mimeType: "application/pdf", fileType: "application/pdf",
      size: 1024, fileSize: 1024, uploadedBy: "system", uploadedByUser: petitionerUserId,
      legacySource: "shared",
    });
  }
  const documentCount = await Document.countDocuments({ caseId });
  assert.ok(documentCount >= CHECKLIST_DOCS.length, "checklist documents must be linked to the case");

  // --- S4: Intake submission ---
  caseDoc.status = "active";
  await caseDoc.save();

  // --- S5: Form assignment. i130.seed.js tags I-130's visaTypes with
  // ["K-3", "I-130"] - no K-3-specific assignment code exists or is needed. ---
  await uscisFormService.ensureAssignedForms(caseDoc, teamLead(), req);
  const i130Form = await CaseForm.findOne({ caseId, formCode: "I-130" });
  assert.ok(i130Form, "an I-130 CaseForm must be created for a K-3 case");

  // --- T1: idempotency of form assignment ---
  await uscisFormService.ensureAssignedForms(await Case.findById(caseId), teamLead(), req);
  const i130CountAfterRerun = await CaseForm.countDocuments({ caseId, formCode: "I-130" });
  assert.equal(i130CountAfterRerun, 1, "re-running assignment must not duplicate the I-130 CaseForm");

  // --- S6: Form generation (fill) + field assertions ---
  const { caseForm: aiFilled } = await AutoFillService.generate(caseId, "I-130", { _id: petitionerUserId, role: "client" }, req);
  const template = await USCISFormTemplate.findById(aiFilled.formTemplateId).lean();
  const fieldNameToId = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
  const get = (fieldName) => MappingResolver.resolvePath(aiFilled.filledData, fieldNameToId.get(fieldName));

  // Relationship: Spouse checked (K-3 is inherently spousal).
  assert.equal(get("form1[0].#subform[0].Pt1Line1_Spouse[0]"), true);

  // Petitioner ("Part 2: Information About You" on I-130) identity.
  assert.equal(get("form1[0].#subform[0].Pt2Line4a_FamilyName[0]"), BASE.petitioner.lastName);
  assert.equal(get("form1[0].#subform[0].Pt2Line4b_GivenName[0]"), BASE.petitioner.firstName);
  assert.equal(get("form1[0].#subform[1].Pt2Line6_CityTownOfBirth[0]"), BASE.petitioner.cityTownOfBirth);
  assert.equal(get("form1[0].#subform[1].Pt2Line9_Male[0]"), true, "petitioner Male widget must be checked");
  assert.notEqual(get("form1[0].#subform[1].Pt2Line9_Female[0]"), true);
  assert.equal(get("form1[0].#subform[1].Pt2Line17_Married[0]"), true, "petitioner Married widget must be checked");
  ["Single", "Widowed", "Divorced"].forEach((w) => assert.notEqual(get(`form1[0].#subform[1].Pt2Line17_${w}[0]`), true, `${w} must not be checked`));

  // Beneficiary ("Part 4: Information About Beneficiary" on I-130) identity.
  assert.equal(get("form1[0].#subform[4].Pt4Line4a_FamilyName[0]"), BASE.beneficiary.lastName);
  assert.equal(get("form1[0].#subform[4].Pt4Line4b_GivenName[0]"), BASE.beneficiary.firstName);
  assert.equal(get("form1[0].#subform[4].Pt4Line8_CountryOfBirth[0]"), BASE.beneficiary.countryOfBirth);
  assert.notEqual(get("form1[0].#subform[4].Pt4Line9_Male[0]"), true);
  assert.equal(get("form1[0].#subform[4].Pt4Line9_Female[0]"), true, "beneficiary Female widget must be checked");
  assert.equal(get("form1[0].#subform[5].Pt4Line18_MaritalStatus[4]"), true, "beneficiary Married widget (index 4, onValue /M) must be checked");

  // A confirmed, genuinely out-of-crosswalk field (v1 scope excludes address
  // blocks/repeating history groups/biographic details) - must assert
  // empty, never guessed.
  assert.equal(get("form1[0].#subform[0].Pt2Line10_StreetNumberName[0]"), undefined, "petitioner mailing address is out of scope for the v1 K-3 crosswalk - must stay empty, not guessed");
});
