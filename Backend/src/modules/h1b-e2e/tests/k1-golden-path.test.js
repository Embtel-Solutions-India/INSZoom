// K-1 golden-path e2e test, mirroring l1a-golden-path.test.js's scope (S1-S6:
// case creation -> questionnaire intake -> document uploads -> form
// assignment -> autofill + field assertions), adapted for the family-workflow
// petitioner/beneficiary participant model (Case.petitionerUser/
// beneficiaryUser) instead of employer/employee.
//
// NOTE: written and reviewed against the real k1.js/i129f-k1-crosswalk.js
// source, but NOT executed in the authoring environment - no reachable
// MongoDB there (see l1a-golden-path.test.js's identical note). Run
// `npm run test:e2e` in an environment with DB access to verify.
const assert = require("node:assert/strict");
const test = require("node:test");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const { BASE, petitionerAnswers, beneficiaryAnswers } = require("../../../test-utils/fixtures/k1-golden");

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
  { documentType: "petitioner_intent_to_marry_letter", title: "Petitioner Intent to Marry Letter" },
  { documentType: "beneficiary_passport_copy", title: "Beneficiary Passport" },
  { documentType: "beneficiary_intent_to_marry_letter", title: "Beneficiary Intent to Marry Letter" },
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

test("K-1 golden path: S1-S6 against the real pipeline", async () => {
  // --- S1: Case creation (petitioner/beneficiary participant model) ---
  const petitionerUser = await User.create({ email: "daniel.whitfield.k1@example.com", password: "not-a-real-hash", name: `${BASE.petitioner.firstName} ${BASE.petitioner.lastName}`, role: "client" });
  petitionerUserId = petitionerUser._id;
  const beneficiaryUser = await User.create({ email: "elise.fontaine.k1@example.com", password: "not-a-real-hash", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "beneficiary" });
  beneficiaryUserId = beneficiaryUser._id;
  const caseDoc = await Case.create({
    caseNumber: BASE.caseNumber, visaType: BASE.visaType, caseType: "family",
    petitionerUser: petitionerUser._id, beneficiaryUser: beneficiaryUser._id, user: petitionerUser._id,
    status: "active",
  });
  caseId = caseDoc._id;
  assert.equal(caseDoc.visaType, "K-1");

  // --- S2: Questionnaire intake ---
  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const petitionerQ = await Questionnaire.findOne({ key: "k1_petitioner_checklist", latestVersion: true });
  const beneficiaryQ = await Questionnaire.findOne({ key: "k1_beneficiary_checklist", latestVersion: true });
  assert.ok(petitionerQ, "k1_petitioner_checklist must exist (built by familyChecklists.js)");
  assert.ok(beneficiaryQ, "k1_beneficiary_checklist must exist (built by familyChecklists.js)");
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
  assert.ok(answerCount > 8, "questionnaireData must be populated from this case's own answers");

  // --- S3: Document upload records (metadata only) ---
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

  // --- S5: Form assignment. i129f.seed.js tags I-129F's visaTypes with
  // ["K-1"] - no K-1-specific assignment code exists or is needed. ---
  await uscisFormService.ensureAssignedForms(caseDoc, teamLead(), req);
  const i129fForm = await CaseForm.findOne({ caseId, formCode: "I-129F" });
  assert.ok(i129fForm, "an I-129F CaseForm must be created for a K-1 case");

  // --- T1: idempotency of form assignment ---
  await uscisFormService.ensureAssignedForms(await Case.findById(caseId), teamLead(), req);
  const i129fCountAfterRerun = await CaseForm.countDocuments({ caseId, formCode: "I-129F" });
  assert.equal(i129fCountAfterRerun, 1, "re-running assignment must not duplicate the I-129F CaseForm");

  // --- S6: Form generation (fill) + field assertions ---
  const { caseForm: aiFilled } = await AutoFillService.generate(caseId, "I-129F", { _id: petitionerUserId, role: "client" }, req);
  const template = await USCISFormTemplate.findById(aiFilled.formTemplateId).lean();
  const fieldNameToId = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
  const get = (fieldName) => MappingResolver.resolvePath(aiFilled.filledData, fieldNameToId.get(fieldName));

  // Petitioner identity.
  assert.equal(get("form1[0].#subform[0].Pt1Line6a_FamilyName[0]"), BASE.petitioner.lastName);
  assert.equal(get("form1[0].#subform[0].Pt1Line6b_GivenName[0]"), BASE.petitioner.firstName);
  assert.equal(get("form1[0].#subform[2].Pt1Line24_CityTownOfBirth[0]"), BASE.petitioner.cityTownOfBirth);
  assert.equal(get("form1[0].#subform[2].Pt1Line25_ProvinceOrStateOfBirth[0]"), BASE.petitioner.stateProvinceOfBirth);

  // Petitioner gender/marital status checkboxes (onValues verified via pdf-lib).
  assert.equal(get("form1[0].#subform[2].Pt1Line21_Checkbox[0]"), true, "Male widget must be checked");
  assert.notEqual(get("form1[0].#subform[2].Pt1Line21_Checkbox[1]"), true, "Female widget must not be checked");
  assert.equal(get("form1[0].#subform[2].Pt1Line23_Checkbox[2]"), true, "Single widget (index 2, onValue /S) must be checked");
  [0, 1, 3].forEach((i) => assert.notEqual(get(`form1[0].#subform[2].Pt1Line23_Checkbox[${i}]`), true, `Pt1Line23_Checkbox[${i}] must not be checked`));

  // Beneficiary identity.
  assert.equal(get("form1[0].#subform[3].Pt2Line1a_FamilyName[0]"), BASE.beneficiary.lastName);
  assert.equal(get("form1[0].#subform[3].Pt2Line1b_GivenName[0]"), BASE.beneficiary.firstName);
  assert.equal(get("form1[0].#subform[3].Pt2Line8_CountryOfBirth[0]"), BASE.beneficiary.countryOfBirth);
  assert.equal(get("form1[0].#subform[3].Pt2Line9_CountryofCitzOrNationality[0]"), BASE.beneficiary.countryOfCitizenship);
  assert.notEqual(get("form1[0].#subform[3].Pt2Line5_Checkboxes[0]"), true, "Male widget must not be checked");
  assert.equal(get("form1[0].#subform[3].Pt2Line5_Checkboxes[1]"), true, "Female widget must be checked");

  // A confirmed, genuinely out-of-crosswalk field (v1 scope excludes address
  // blocks/repeating history groups - see i129f-k1-crosswalk.js's SCOPE
  // note) - must assert empty, never guessed.
  assert.equal(get("form1[0].#subform[0].Pt1Line8_StreetNumberName[0]"), undefined, "petitioner mailing address is out of scope for the v1 K-1 crosswalk - must stay empty, not guessed");
});
