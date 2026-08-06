// L-1A golden-path e2e test, mirroring h1b-golden-path.test.js's structure
// (S1-S6: case creation -> questionnaire intake -> document uploads -> form
// assignment -> autofill + field assertions). Deliberately does NOT re-test
// S7-S12 (case manager review, PDF generation, petition assembly) - those
// exercise generic services (InteractiveFormReviewService,
// PDFGenerationService, PetitionAssemblyService) that don't branch on visa
// type and are already covered by h1b-golden-path.test.js; re-running them
// here would test the same code path twice, not L-1A-specific behavior.
//
// NOTE: written and reviewed against the real l1a.js/i129-h1b-crosswalk.js
// source, but NOT executed in the authoring environment - that sandbox has
// no reachable MongoDB (neither the configured Atlas cluster nor a local
// mongod), so this suite (like h1b-golden-path.test.js, which has the same
// dependency) could not be run or verified end-to-end there. Run
// `npm run test:e2e` in an environment with DB access to verify.
const assert = require("node:assert/strict");
const test = require("node:test");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const { BASE, employerAnswers, employeeAnswers } = require("../../../test-utils/fixtures/l1a-golden");

const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const Answer = require("../../../models/Answer");
const AuditLog = require("../../../models/AuditLog");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const Questionnaire = require("../../../models/Questionnaire");
const User = require("../../../models/User");
const Beneficiary = require("../../../models/Beneficiary");
const Company = require("../../../models/Company");

const questionnaireService = require("../../questionnaires/questionnaire.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const MappingResolver = require("../../form-mapping/services/MappingResolver");

const CHECKLIST_DOCS = [
  { documentType: "us_articles_of_incorporation", title: "US Articles of Incorporation" },
  { documentType: "foreign_business_registration", title: "Foreign Business Registration" },
  { documentType: "passport", title: "Beneficiary Passport" },
  { documentType: "updated_resume", title: "Beneficiary Updated Resume" },
  { documentType: "us_organizational_chart", title: "US Organizational Chart" },
];

let caseId;
let userId;
let beneficiaryId;
let companyId;
const req = { ip: "127.0.0.1", headers: {} };
const teamLead = () => ({ _id: userId, role: "team_lead" });

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
  if (beneficiaryId) await Beneficiary.deleteOne({ _id: beneficiaryId });
  if (companyId) await Company.deleteOne({ _id: companyId });
  if (userId) await User.deleteOne({ _id: userId });
  await disconnectTestDB();
});

test("L-1A golden path: S1-S6 against the real pipeline", async () => {
  // --- S1: Case creation ---
  const user = await User.create({ email: "priya.nair.l1a@example.com", password: "not-a-real-hash", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "client" });
  userId = user._id;
  const beneficiary = await Beneficiary.create({ user: user._id, firstName: BASE.beneficiary.firstName, lastName: BASE.beneficiary.lastName, dateOfBirth: BASE.beneficiary.dateOfBirth, alienRegistrationNumber: "" });
  beneficiaryId = beneficiary._id;
  const company = await Company.create({ name: BASE.usCompany.name, ein: BASE.usCompany.ein });
  companyId = company._id;
  const caseDoc = await Case.create({ caseNumber: BASE.caseNumber, visaType: BASE.visaType, user: user._id, beneficiary: beneficiary._id, companyId: company._id, status: "active" });
  caseId = caseDoc._id;
  assert.equal(caseDoc.visaType, "L-1A");

  // --- S2: Questionnaire intake ---
  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const employerQ = await Questionnaire.findOne({ key: "l1a_employer_checklist", latestVersion: true });
  const employeeQ = await Questionnaire.findOne({ key: "l1a_employee_checklist", latestVersion: true });
  assert.ok(employerQ, "l1a_employer_checklist must exist (built by employmentChecklists.js)");
  assert.ok(employeeQ, "l1a_employee_checklist must exist (built by employmentChecklists.js)");
  await questionnaireService.saveAnswers({
    questionnaireId: employerQ._id,
    caseId,
    answers: Object.entries(employerAnswers()).map(([questionKey, value]) => ({ questionKey, value })),
  }, { _id: userId, role: "client" }, req, "submitted");
  await questionnaireService.saveAnswers({
    questionnaireId: employeeQ._id,
    caseId,
    answers: Object.entries(employeeAnswers()).map(([questionKey, value]) => ({ questionKey, value })),
  }, { _id: userId, role: "client" }, req, "submitted");
  const answerCount = await Answer.countDocuments({ caseId });
  assert.ok(answerCount > 10, "questionnaireData must be populated from this case's own answers");

  // --- S3: Document upload records (metadata only - no OCR run in this suite) ---
  for (const doc of CHECKLIST_DOCS) {
    await Document.create({
      user: userId, caseId, category: "evidence", documentType: doc.documentType, reviewStatus: "approved",
      description: doc.title, originalName: `${doc.documentType}.pdf`, originalFileName: `${doc.documentType}.pdf`,
      storedName: `${doc.documentType}.pdf`, fileName: `${doc.documentType}.pdf`, mimeType: "application/pdf", fileType: "application/pdf",
      size: 1024, fileSize: 1024, uploadedBy: "system", uploadedByUser: userId,
      legacySource: "shared",
    });
  }
  const documentCount = await Document.countDocuments({ caseId });
  assert.ok(documentCount >= CHECKLIST_DOCS.length, "checklist documents must be linked to the case");

  // --- S4: Intake submission ---
  caseDoc.status = "active";
  await caseDoc.save();

  // --- S5: Form assignment. i129.seed.js tags I-129's visaTypes with
  // ["H-1B", "L-1A", "L-1B"], so the same base-form assignment logic H-1B
  // relies on already covers L-1A - no L-1A-specific assignment code exists
  // or is needed. ---
  await uscisFormService.ensureAssignedForms(caseDoc, teamLead(), req);
  const i129Form = await CaseForm.findOne({ caseId, formCode: "I-129" });
  assert.ok(i129Form, "an I-129 CaseForm must be created for an L-1A case");

  // --- T1: idempotency of form assignment ---
  await uscisFormService.ensureAssignedForms(await Case.findById(caseId), teamLead(), req);
  const i129CountAfterRerun = await CaseForm.countDocuments({ caseId, formCode: "I-129" });
  assert.equal(i129CountAfterRerun, 1, "re-running assignment must not duplicate the I-129 CaseForm");

  // --- S6: Form generation (fill) + field assertions ---
  const { caseForm: aiFilled } = await AutoFillService.generate(caseId, "I-129", { _id: userId, role: "client" }, req);
  const template = await USCISFormTemplate.findById(aiFilled.formTemplateId).lean();
  const fieldNameToId = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
  const get = (fieldName) => MappingResolver.resolvePath(aiFilled.filledData, fieldNameToId.get(fieldName));

  // Beneficiary identity - shared with H-1B via the generic
  // canonicalPathForEntry mechanism (employmentChecklists.js), since
  // l1a.js's employee.personal.* sub-paths match h1b.js's exactly.
  assert.equal(get("form1[0].#subform[1].Part3_Line2_FamilyName[0]"), BASE.beneficiary.lastName);
  assert.equal(get("form1[0].#subform[1].Part3_Line2_GivenName[0]"), BASE.beneficiary.firstName);
  assert.equal(get("form1[0].#subform[2].Part3Line4_CountryOfBirth[0]"), BASE.beneficiary.countryOfBirth);
  assert.equal(get("form1[0].#subform[2].Part3Line4_CountryOfCitizenship[0]"), BASE.beneficiary.countryOfCitizenship);
  assert.equal(get("form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]"), BASE.beneficiary.passportNumber);
  assert.equal(get("form1[0].#subform[2].Line8a_StreetNumberName[0]"), BASE.beneficiary.currentUsAddress.street);
  assert.equal(get("form1[0].#subform[2].Line8d_CityTown[0]"), BASE.beneficiary.currentUsAddress.city);

  // Petitioner identity - company.name is canonical (not
  // raw.questionnaireAnswers-keyed), so it resolves regardless of visa type.
  assert.equal(get("form1[0].#subform[0].Line3_CompanyorOrgName[0]"), BASE.usCompany.name);

  // KNOWN GAP (see i129-h1b-crosswalk.js's Part 1 comment): petitioner
  // mailing address is keyed to h1b.js's "employer_company_address_*"
  // convention, which does not match l1a.js's "employer_usCompany_*" - must
  // assert empty here, not a guessed/wrong value, until that gap is closed.
  assert.equal(get("form1[0].#subform[0].Line7b_StreetNumberName[0]"), undefined, "known gap: L-1A's US company address key convention differs from H-1B's - see crosswalk comment");

  // Classification: L-1A checked, L-1B not.
  assert.equal(get("form1[0].#subform[25].a_L1A[0]"), true);
  assert.notEqual(get("form1[0].#subform[25].b_L1B[0]"), true);

  // L Classification Supplement - employer abroad identity/address.
  assert.equal(get("form1[0].#subform[25].LSuppLine3_NameofEmployerAbroad[0]"), BASE.foreignCompany.name);
  assert.equal(get("form1[0].#subform[25].Part3Line2_StreetName[0]"), BASE.foreignCompany.address.street);
  assert.equal(get("form1[0].#subform[25].Part3Line2_City[0]"), BASE.foreignCompany.address.city);
  assert.equal(get("form1[0].#subform[25].Part3Line2_Province[0]"), BASE.foreignCompany.address.stateProvince);
  assert.equal(get("form1[0].#subform[25].Part3Line2_PostalCode[0]"), BASE.foreignCompany.address.zipPostalCode);
  assert.equal(get("form1[0].#subform[25].Part3Line2_Country[0]"), BASE.foreignCompany.address.country);
  assert.equal(get("form1[0].#subform[25].Table2[0].Row1[0].DateFrom_line1[0]"), "06/01/2022");
  assert.equal(get("form1[0].#subform[25].Table2[0].Row1[0].DateTo_line1[0]"), "05/31/2026");

  // Relationship type: Subsidiary checked, all sibling widgets false.
  assert.equal(get("form1[0].#subform[27].c_Subsidiary[0]"), true);
  ["a_Parent", "b_Branch", "d_Affiliate", "e_JointVenture"].forEach((box) => {
    assert.notEqual(get(`form1[0].#subform[27].${box}[0]`), true, `${box} must not be checked for a Subsidiary relationship`);
  });

  // A confirmed, genuinely out-of-crosswalk field (blanket-petition-only,
  // per L_BLANKET_OUT_OF_SCOPE_FIELDS) - must assert empty, never guessed.
  assert.equal(get("form1[0].#subform[25].a_individual[0]"), undefined, "individual-vs-blanket selector has no canonical source - must stay empty, not guessed");
});
