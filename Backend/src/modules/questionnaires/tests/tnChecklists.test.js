const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const { VISA_CATEGORIES } = require("../../../config/visaCategories");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");

// TN (NAFTA/USMCA professional) - employer_employee, two separate
// checklists (employer + employee/beneficiary), mirroring H-1B/L-1A/I-140's
// own established conversion pattern. DB-free.
//
// Critical finding from inspection: this codebase's REAL, already-wired TN
// identifiers are "TN Canada" and "TN Mexico" (visaCategories.js,
// visaFormMappings.seed.js), not a bare "TN" - both already correctly
// distinguish the border/port-of-entry vs COS/extension filing paths per
// country from an earlier session. The checklist is therefore registered
// under visaTypes: ["TN Canada", "TN Mexico", ...] (shared content, same
// convention i140.js already established for EB-2/EB-3), not a new value.

const employer = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "tn_employer_checklist");
const employee = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "tn_employee_checklist");

function documentTypesOf(definition) {
  return definition.questions.filter((q) => q.type === "file").map((q) => q.metadata?.documentType || q.key);
}

test("exactly one shared TN employer checklist and one shared employee checklist exist", () => {
  assert.ok(employer, "tn_employer_checklist must exist");
  assert.ok(employee, "tn_employee_checklist must exist");
  const tnKeys = EMPLOYMENT_CHECKLIST_DEFINITIONS.map((def) => def.key).filter((key) => key.startsWith("tn_"));
  assert.deepEqual(tnKeys.sort(), ["tn_employee_checklist", "tn_employer_checklist"]);
});

test("registered under the REAL, already-wired 'TN Canada'/'TN Mexico' identifiers, correctly normalized for getQuestionnaireForCase's space/dash-stripped matching", () => {
  [employer, employee].forEach((def) => {
    assert.ok(def.visaTypes.includes("TN Canada"));
    assert.ok(def.visaTypes.includes("TN Mexico"));
    // The load-bearing entries: getQuestionnaireForCase strips spaces/
    // dashes and uppercases the CASE's own visaType before matching, so
    // "TN Canada" (with the space) can never itself match - only the
    // stripped form can.
    const normalize = (value) => value.replace(/[-\s]/g, "").toUpperCase();
    const caseVisaType = "TN Canada";
    const pattern = new RegExp(`^${normalize(caseVisaType)}$`, "i");
    assert.ok(def.visaTypes.some((v) => pattern.test(v)), "at least one visaTypes entry must actually match a real 'TN Canada' case after normalization");
  });
});

test("case classification: TN Canada and TN Mexico are both registered as employer_employee (not family, not single-person)", () => {
  ["TN Canada", "TN Mexico"].forEach((visaType) => {
    const entry = VISA_CATEGORIES[visaType];
    assert.ok(entry, `${visaType} must be registered in visaCategories`);
    assert.equal(entry.caseStructure, "employer_employee");
  });
});

test("checklistRole is employer/employee, matching the existing employer_employee case structure - no petitioner/beneficiary/applicant role invented", () => {
  assert.equal(employer.checklistRole, "employer");
  assert.equal(employee.checklistRole, "employee");
  assert.equal(employer.title, "TN Visa – Employer Checklist");
  assert.equal(employee.title, "TN Visa – Employee/Beneficiary Checklist");
});

test("employer and employee checklists carry disjoint role-based visibility - employer questions never visible to employee and vice versa", () => {
  assert.ok(employer.questions.every((q) => q.visibility.roles.includes("employer") && !q.visibility.roles.includes("employee")));
  assert.ok(employee.questions.every((q) => q.visibility.roles.includes("employee") && !q.visibility.roles.includes("employer")));
});

test("no duplicate question keys within either checklist", () => {
  [employer, employee].forEach((def) => {
    const keys = def.questions.map((q) => q.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${def.key} has duplicate question keys: ${duplicates.join(", ")}`);
  });
});

test("employer document checklist matches the source exactly (6 documents), never merged into the employee checklist", () => {
  const docTypes = documentTypesOf(employer);
  assert.equal(docTypes.length, 6);
  ["tn_petitioner_articles_of_incorporation", "tn_petitioner_business_license", "tn_petitioner_company_brochure", "tn_petitioner_previous_year_tax_returns", "tn_petitioner_offer_letter", "tn_petitioner_letterhead"]
    .forEach((docType) => assert.ok(docTypes.includes(docType), `${docType} missing from employer checklist`));
  const employeeDocTypes = documentTypesOf(employee);
  docTypes.forEach((docType) => assert.ok(!employeeDocTypes.includes(docType), `${docType} must not also appear on the employee checklist`));
});

test("employee document checklist matches the source exactly (13 documents), optional ones kept optional", () => {
  const docs = employee.questions.filter((q) => q.type === "file");
  assert.equal(docs.length, 13);
  const optionalDocs = ["tn_beneficiary_credential_evaluation_report", "tn_beneficiary_training_diploma_certificates", "tn_beneficiary_awards_certifications", "tn_beneficiary_previous_work_experience_letters", "tn_beneficiary_previous_i797_notices", "tn_beneficiary_i94_copy", "tn_beneficiary_ssn_copy", "tn_beneficiary_drivers_license_or_state_id"];
  optionalDocs.forEach((key) => assert.equal(docs.find((d) => d.metadata.documentType === key).required, false, `${key} must be optional`));
  ["tn_beneficiary_visa_letter", "tn_beneficiary_academic_certificates", "tn_beneficiary_updated_resume", "tn_beneficiary_passport", "tn_beneficiary_proof_of_citizenship"]
    .forEach((key) => assert.equal(docs.find((d) => d.metadata.documentType === key).required, true, `${key} must be required`));
});

test("employer checklist company/proposed-employment fields match the source (spot check)", () => {
  ["employer_company_legalName", "employer_company_fein", "employer_company_grossAnnualIncome", "employer_signingPerson_email", "employer_position_jobTitle", "employer_position_salaryFrequency", "employer_endClient_name"]
    .forEach((key) => assert.ok(employer.questions.some((q) => q.key === key), `${key} missing from employer checklist`));
  const salaryFrequency = employer.questions.find((q) => q.key === "employer_position_salaryFrequency");
  assert.deepEqual(salaryFrequency.options.map((o) => o.value), ["Hour", "Week", "Bi-weekly", "Month", "Year"]);
});

test("employee checklist: conditional inside-US and outside-US sections are correctly gated and mutually independent", () => {
  const insideFields = ["employee_immigrationStatus_dateOfLastArrival", "employee_immigrationStatus_i94Number", "employee_immigrationStatus_currentVisaStatus", "employee_immigrationStatus_statusExpirationDate"];
  insideFields.forEach((key) => {
    const q = employee.questions.find((question) => question.key === key);
    assert.ok(q, `${key} missing`);
    assert.deepEqual(q.conditionalLogic.rules, [{ questionKey: "employee_immigrationStatus_insideUnitedStates", operator: "equals", value: "Yes" }]);
  });
  const outsideFields = ["employee_immigrationStatus_consulateCity", "employee_immigrationStatus_consulateCountry", "employee_immigrationStatus_foreignAddress"];
  outsideFields.forEach((key) => {
    const q = employee.questions.find((question) => question.key === key);
    assert.ok(q, `${key} missing`);
    assert.deepEqual(q.conditionalLogic.rules, [{ questionKey: "employee_immigrationStatus_applyingFromOutsideUs", operator: "equals", value: "Yes" }]);
  });
});

test("employee checklist: eligibility/history Yes-No questions are structured fields, not free text, with correct conditional gating", () => {
  const denied = employee.questions.find((q) => q.key === "employee_immigrationHistory_previousTnDenied");
  assert.equal(denied.type, "radio");
  assert.deepEqual(denied.options.map((o) => o.value), ["Yes", "No"]);
  const explanation = employee.questions.find((q) => q.key === "employee_immigrationHistory_previousTnDenialExplanation");
  assert.deepEqual(explanation.conditionalLogic.rules, [{ questionKey: "employee_immigrationHistory_previousTnDenied", operator: "equals", value: "Yes" }]);

  const hasDependents = employee.questions.find((q) => q.key === "employee_immigrationHistory_hasDependents");
  assert.equal(hasDependents.type, "radio");
  const numberOfDependents = employee.questions.find((q) => q.key === "employee_immigrationHistory_numberOfDependents");
  assert.deepEqual(numberOfDependents.conditionalLogic.rules, [{ questionKey: "employee_immigrationHistory_hasDependents", operator: "equals", value: "Yes" }]);
});

test("employee checklist: passport information fields are unconditional (always collected)", () => {
  ["employee_passport_number", "employee_passport_issueDate", "employee_passport_expirationDate"].forEach((key) => {
    const q = employee.questions.find((question) => question.key === key);
    assert.ok(q);
    assert.deepEqual(q.conditionalLogic.rules, []);
  });
});

test("VisaFormMapping: TN Canada/TN Mexico form mapping is untouched by this task and already correctly distinguishes border/consular from COS/extension", () => {
  const canada = mappings.filter((m) => m.visaType === "TN Canada");
  const mexico = mappings.filter((m) => m.visaType === "TN Mexico");
  assert.ok(canada.length > 0 && mexico.length > 0, "TN Canada/TN Mexico VisaFormMapping rows must already exist");
  const canadaI129 = canada.find((m) => m.formNumber === "I-129");
  const mexicoI129 = mexico.find((m) => m.formNumber === "I-129");
  assert.equal(canadaI129.provisioningType, "CONDITIONAL", "I-129 must never be auto-created merely because the visa is TN");
  assert.equal(mexicoI129.provisioningType, "CONDITIONAL");
});

test("no other visa type's employer/employee checklist definitions were disturbed by this addition", () => {
  ["h1b_employer_checklist", "h1b_employee_checklist", "l1a_employer_checklist", "i140_petitioner_checklist"].forEach((key) => {
    assert.ok(EMPLOYMENT_CHECKLIST_DEFINITIONS.some((def) => def.key === key), `${key} must still exist unchanged`);
  });
  // 15 -> 18 by the later, unrelated E-2 task (e2.js added its own three
  // checklists: visa, business_plan, supporting_documents) - see
  // e2Checklists.test.js.
  assert.equal(EMPLOYMENT_CHECKLIST_DEFINITIONS.length, 18, "H1B x2, L1A x3, P x2, O1 x2, EB1B x2, I-140 x2, TN x2, E-2 x3 = 18");
});
