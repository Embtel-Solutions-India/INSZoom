// End to end through the REAL pipeline: H-1B employer + employee checklist answers -> canonical profile (petitioner.* / beneficiary.*) -> I-129 boxes.
// The case is created WITHOUT a Company or Beneficiary record, so every petitioner / beneficiary value on the form can only have come from the checklists.
// Local isolated test database only (test-utils/db.js); only this file's own records are removed. The case is created as an already-released (grandfathered)
// case: the checklist-release gate of new cases is a separate feature with its own tests.
process.env.PARTY_CHECKLIST_PATHS = "on"; // the generic-path definitions are opt-in (see questionnaire.service.js)
const assert = require("node:assert/strict");
const test = require("node:test");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const { BASE, employerAnswers, employeeAnswers } = require("../../../test-utils/fixtures/h1b-golden");

const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Answer = require("../../../models/Answer");
const User = require("../../../models/User");
const Questionnaire = require("../../../models/Questionnaire");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const MappingResolver = require("../../form-mapping/services/MappingResolver");

const req = { ip: "127.0.0.1", headers: {} };
const made = { caseId: null, userId: null };

test.after(async () => {
  if (made.caseId) {
    await CaseForm.deleteMany({ caseId: made.caseId });
    await Answer.deleteMany({ caseId: made.caseId });
    await Case.deleteOne({ _id: made.caseId });
  }
  if (made.userId) await User.deleteOne({ _id: made.userId });
  await disconnectTestDB();
});

test("H-1B checklists store petitioner.* / beneficiary.*; the I-129 boxes are filled from them; the old shared paths still receive the same facts", async (t) => {
  await connectTestDB();
  const user = await User.create({ email: `generic-party.${Date.now()}@example.com`, password: "not-a-real-hash", name: "Generic Party Test", role: "client" });
  made.userId = user._id;
  const caseDoc = await Case.create({ caseNumber: `H1B-GENERIC-${Date.now()}`, visaType: BASE.visaType, user: user._id, status: "active", checklistApproval: { required: false } });
  made.caseId = caseDoc._id;

  const employerQ = await Questionnaire.findOne({ key: "h1b_employer_checklist", latestVersion: true });
  const employeeQ = await Questionnaire.findOne({ key: "h1b_employee_checklist", latestVersion: true });
  assert.ok(employerQ && employeeQ);
  const actor = { _id: user._id, role: "client" };
  await questionnaireService.saveAnswers({ questionnaireId: employerQ._id, caseId: caseDoc._id, answers: Object.entries(employerAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, actor, req, "submitted");
  await questionnaireService.saveAnswers({ questionnaireId: employeeQ._id, caseId: caseDoc._id, answers: Object.entries(employeeAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, actor, req, "submitted");

  const staff = { _id: user._id, role: "team_lead" };
  await uscisFormService.ensureAssignedForms(await Case.findById(caseDoc._id), staff, req);
  const { caseForm } = await AutoFillService.generate(caseDoc._id, "I-129", actor, req);

  // 1. the canonical profile: the generic paths hold the facts ...
  const profile = (await Case.findById(caseDoc._id).select("canonicalProfile.profile").lean()).canonicalProfile.profile;
  const at = (path) => MappingResolver.resolvePath(profile, path);
  // (answers go through the existing name normalization, which capitalises "dba" - that is not what this test is about, so company names compare case-insensitively)
  const sameText = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();
  assert.ok(sameText(at("petitioner.name"), BASE.petitioner.legalName), `employer name stored as petitioner.name (${at("petitioner.name")})`);
  assert.equal(at("petitioner.ein"), BASE.petitioner.fein);
  assert.equal(at("petitioner.address.city"), BASE.petitioner.address.city);
  assert.equal(at("beneficiary.lastName"), BASE.beneficiary.lastName, "employee name stored as beneficiary.lastName");
  assert.equal(at("beneficiary.firstName"), BASE.beneficiary.firstName);
  assert.equal(at("beneficiary.passport.number"), BASE.beneficiary.passportNumber);
  // ... and the older shared paths other forms still read receive the same facts (back-fill), never different ones
  assert.ok(sameText(at("company.name"), BASE.petitioner.legalName), "legacy company.name back-filled");
  assert.equal(at("person.lastName"), BASE.beneficiary.lastName, "legacy person.lastName back-filled");
  assert.equal(at("person.passport.number"), BASE.beneficiary.passportNumber);

  // 2. the form: the same boxes the golden path asserts, filled from the generic paths
  const template = await USCISFormTemplate.findById(caseForm.formTemplateId).lean();
  const fieldIdOf = new Map(template.formFields.map((field) => [field.fieldName, field.fieldId]));
  const get = (fieldName) => MappingResolver.resolvePath(caseForm.filledData, fieldIdOf.get(fieldName));
  const expected = [
    ["form1[0].#subform[1].Part3_Line2_FamilyName[0]", BASE.beneficiary.lastName],
    ["form1[0].#subform[1].Part3_Line2_GivenName[0]", BASE.beneficiary.firstName],
    ["form1[0].#subform[2].Part3Line4_CountryOfBirth[0]", BASE.beneficiary.countryOfBirth],
    ["form1[0].#subform[2].Part3Line4_CountryOfCitizenship[0]", BASE.beneficiary.countryOfCitizenship],
    ["form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]", BASE.beneficiary.passportNumber],
    ["form1[0].#subform[0].Line3_CompanyorOrgName[0]", BASE.petitioner.legalName],
    ["form1[0].#subform[0].Line7b_StreetNumberName[0]", BASE.petitioner.address.street],
    ["form1[0].#subform[13].Line1_PetitionerName[0]", BASE.petitioner.legalName],
    ["form1[0].#subform[4].Line8_Wages[0]", BASE.position.offeredSalary],
    ["form1[0].#subform[24].H1bSec3Line3a_Name[0]", BASE.education.usInstitutionName],
    ["form1[0].#subform[13].SubHLine5_ConfirmationNum[0]", BASE.capRegistration.beneficiaryConfirmationNumber],
    ["form1[0].#subform[15].ClassHLine5b_PassportorTravDoc[0]", BASE.capRegistration.passportNumber],
    ["form1[0].#subform[15].ClassHLine5b_CountryOfIssuance[0]", BASE.capRegistration.passportCountry],
  ];
  const wrong = expected.map(([name, value]) => [name, value, get(name)]).filter(([, want, got]) => !sameText(got, want)).map(([name, want, got]) => `${name.split(".").pop()}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  assert.deepEqual(wrong, [], "I-129 boxes filled from the generic petitioner / beneficiary paths");
  // which path did the filled boxes read? Most of the party facts must come from petitioner.* / beneficiary.*, none from a checklist question key
  const readFrom = new Map();
  Object.entries(caseForm.sourceAttribution || {}).filter(([id, entry]) => entry && entry.sourceField && caseForm.fieldValues?.[id] !== undefined).forEach(([, entry]) => {
    const root = String(entry.sourceField).split(".")[0];
    readFrom.set(root, (readFrom.get(root) || 0) + 1);
  });
  t.diagnostic(`boxes by the root of the path they read: ${JSON.stringify(Object.fromEntries(readFrom))}; report ${JSON.stringify({ populated: caseForm.autoFillReport?.summary?.populated, status: caseForm.autoFillReport?.summary?.status })}`);
  assert.ok((readFrom.get("petitioner") || 0) >= 10, "many boxes read petitioner.*");
  assert.ok((readFrom.get("beneficiary") || 0) >= 10, "many boxes read beneficiary.*");
});
