const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");

// EB-2/EB-3 I-140 checklist integration. Both visa types file the same
// independent Form I-140 regardless of subtype, so this must be ONE shared
// petitioner checklist + ONE shared beneficiary checklist (never a
// duplicated EB2_Petitioner_Checklist/EB3_Petitioner_Checklist pair) —
// DB-free, following employmentChecklists.test.js's own established
// convention (EMPLOYMENT_CHECKLIST_DEFINITIONS is a pure, deterministic
// computation, no Mongoose needed).

const petitioner = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "i140_petitioner_checklist");
const beneficiary = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "i140_beneficiary_checklist");

function documentTypesOf(definition) {
  return definition.questions.filter((q) => q.type === "file").map((q) => q.metadata?.documentType || q.key);
}

test("exactly one shared I-140 petitioner checklist and one shared beneficiary checklist exist", () => {
  assert.ok(petitioner, "i140_petitioner_checklist must exist");
  assert.ok(beneficiary, "i140_beneficiary_checklist must exist");
  // No per-visa duplicates such as eb2_petitioner_checklist/eb3_petitioner_checklist.
  const i140Keys = EMPLOYMENT_CHECKLIST_DEFINITIONS.map((def) => def.key).filter((key) => /i140|eb2|eb3/i.test(key));
  assert.deepEqual(i140Keys.sort(), ["i140_beneficiary_checklist", "i140_petitioner_checklist"]);
});

test("both checklists resolve for EB-2 and EB-3 (hyphenated and stripped forms), and no other visa type", () => {
  for (const definition of [petitioner, beneficiary]) {
    assert.deepEqual(definition.visaTypes.slice().sort(), ["EB-2", "EB-3", "EB2", "EB3"].sort());
    assert.ok(!definition.visaTypes.includes("EB-1A"), "must not apply to EB-1A");
    assert.ok(!definition.visaTypes.includes("EB-2 NIW"), "must not apply to EB-2 NIW - that already has its own, unrelated mapping");
    assert.ok(!definition.visaTypes.includes("EB-2 PERM"), "must not apply to EB-2 PERM specifically - bare EB-2/EB-3 only");
  }
});

test("checklistRole reuses the existing employer/employee pair (matches EB-2/EB-3's employer_employee case structure), display titles still say Petitioner/Beneficiary", () => {
  assert.equal(petitioner.checklistRole, "employer");
  assert.equal(beneficiary.checklistRole, "employee");
  assert.equal(petitioner.title, "Petitioner Checklist for I-140");
  assert.equal(beneficiary.title, "Beneficiary Checklist for I-140");
});

test("petitioner and beneficiary checklists carry disjoint role-based visibility", () => {
  assert.ok(petitioner.questions.every((q) => q.visibility.roles.includes("employer") && !q.visibility.roles.includes("employee")));
  assert.ok(beneficiary.questions.every((q) => q.visibility.roles.includes("employee") && !q.visibility.roles.includes("employer")));
});

test("no duplicate question keys within either checklist", () => {
  for (const definition of [petitioner, beneficiary]) {
    const keys = definition.questions.map((q) => q.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${definition.key} has duplicate question keys: ${duplicates.join(", ")}`);
  }
});

test("petitioner checklist covers the source's document list verbatim", () => {
  const docTypes = documentTypesOf(petitioner);
  ["i140_petitioner_tax_returns", "i140_petitioner_incorporation_papers", "i140_petitioner_business_license", "i140_petitioner_original_labor_certification", "i140_petitioner_letterhead", "i140_petitioner_offer_letter", "i140_petitioner_employment_verification_letter"]
    .forEach((docType) => assert.ok(docTypes.includes(docType), `${docType} missing from petitioner checklist`));
  assert.equal(docTypes.length, 7, "petitioner document list must match the source exactly, no extra invented documents");
});

test("beneficiary checklist covers the source's document list verbatim (base + dependent documents)", () => {
  const docTypes = documentTypesOf(beneficiary);
  ["i140_beneficiary_degree_evaluation", "i140_beneficiary_degrees_and_transcripts", "i140_beneficiary_awards_certifications", "i140_beneficiary_resume_six_years", "i140_beneficiary_offer_letter", "i140_beneficiary_previous_approval_notices", "i140_beneficiary_passport_pages", "i140_beneficiary_i94", "i140_beneficiary_ssn", "i140_beneficiary_drivers_license_or_state_id", "i140_beneficiary_experience_letters", "i140_beneficiary_pay_stubs", "i140_beneficiary_w2"]
    .forEach((docType) => assert.ok(docTypes.includes(docType), `${docType} missing from beneficiary checklist`));
  ["i140_dependent_i94_or_passport", "i140_dependent_approval_notice", "i140_dependent_relationship_certificate"]
    .forEach((docType) => assert.ok(docTypes.includes(docType), `${docType} (dependent doc) missing from beneficiary checklist`));
  assert.equal(docTypes.length, 16, "13 beneficiary + 3 dependent documents, no extra invented documents");
});

test("dependent documents are gated on hasDependents, never shown/required unconditionally", () => {
  const dependentDocs = beneficiary.questions.filter((q) => q.key.startsWith("i140_dependent_"));
  assert.equal(dependentDocs.length, 3);
  dependentDocs.forEach((q) => {
    assert.equal(q.required, false);
    assert.ok(q.conditionalLogic?.rules?.some((r) => r.questionKey === "employee_otherInformation_hasDependents" && r.value === "yes"));
  });
});

test("petitioner checklist company/labor-certification/position fields match the source (spot check)", () => {
  ["employer_company_legalName", "employer_company_ein", "employer_company_uscisOnlineAccountNumber", "employer_laborCertification_dolCaseNumber", "employer_laborCertification_dolFilingDate", "employer_position_jobTitle", "employer_position_socCode", "employer_position_salary", "employer_signingPerson_email"]
    .forEach((key) => assert.ok(petitioner.questions.some((q) => q.key === key), `${key} missing from petitioner checklist`));
});

test("beneficiary checklist personal/immigration fields match the source (spot check)", () => {
  ["employee_personal_lastName", "employee_personal_dateOfBirth", "employee_personal_cityOfBirth", "employee_immigrationStatus_lastArrivalDate", "employee_immigrationStatus_i94Number", "employee_immigrationStatus_alienNumber", "employee_immigrationStatus_priorImmigrantPetitionFiled"]
    .forEach((key) => assert.ok(beneficiary.questions.some((q) => q.key === key), `${key} missing from beneficiary checklist`));
});

test("regression: EB-1A/EB-1B/H-1B/L-1A/P/O-1 checklist definitions are unaffected", () => {
  const untouchedKeys = ["h1b_employer_checklist", "h1b_employee_checklist", "l1a_employer_checklist", "l1a_employee_checklist", "eb1b_employer_checklist", "eb1b_employee_checklist"];
  untouchedKeys.forEach((key) => assert.ok(EMPLOYMENT_CHECKLIST_DEFINITIONS.some((def) => def.key === key), `${key} must still exist unchanged`));
  assert.equal(EMPLOYMENT_CHECKLIST_DEFINITIONS.length, 13, "H1B x2, L1A x3, P x2, O1 x2, EB1B x2, I-140 x2 = 13");
});
