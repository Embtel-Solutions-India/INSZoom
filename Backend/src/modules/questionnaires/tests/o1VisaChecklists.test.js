const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const { evaluateConditionGroup } = require("../condition-evaluator");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");

// O-1 (O-1A/O-1B) questionnaire coverage/fidelity tests, following the same
// DB-free convention as employmentChecklists.test.js / pVisaChecklists.test.js.
// Live DB provisioning and the full employer+employee-same-case/role-
// visibility chain are covered by the same generic mechanism already proven
// live for H-1B and P (see pVisaChecklists.test.js's live-verification note).

const employer = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "o1_employer_checklist");
const employee = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "o1_employee_checklist");

function byKey(definition, key) {
  return definition.questions.find((question) => question.key === key);
}

test("o1_employer_checklist and o1_employee_checklist definitions exist and are registered", () => {
  assert.ok(employer, "o1_employer_checklist definition is missing from EMPLOYMENT_CHECKLIST_DEFINITIONS");
  assert.ok(employee, "o1_employee_checklist definition is missing from EMPLOYMENT_CHECKLIST_DEFINITIONS");
});

test("o1_employer_checklist and o1_employee_checklist have no duplicate question keys", () => {
  for (const definition of [employer, employee]) {
    const keys = definition.questions.map((question) => question.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${definition.key} has duplicate question keys: ${duplicates.join(", ")}`);
  }
});

test("neither O1 checklist definition sets a published status (stays in draft, matching every other built-in template)", () => {
  for (const definition of [employer, employee]) {
    assert.notEqual(definition.status, "published");
  }
});

test("employer_oClassification is a required select offering exactly O-1A/O-1B, mapped to the visaVariant master-data path", () => {
  const field = byKey(employer, "employer_oClassification");
  assert.ok(field);
  assert.equal(field.required, true);
  assert.equal(field.type, "select");
  assert.deepEqual(field.options.map((o) => o.value), ["O-1A", "O-1B"]);
  assert.equal(field.metadata?.masterDataPath, "visaVariant");
});

test("employer checklist has the source's 5 common employer documents (articles of incorporation, business license, company brochure, petitioner/beneficiary contract, blank letterhead)", () => {
  const docKeys = ["o1_articles_of_incorporation", "o1_business_license", "o1_company_brochure", "o1_petitioner_beneficiary_contract", "o1_blank_letterhead"];
  docKeys.forEach((key) => {
    const doc = byKey(employer, key);
    assert.ok(doc, `expected employer document "${key}"`);
    assert.equal(doc.type, "file");
    assert.equal(doc.required, true);
  });
});

test("Job Location is a required repeating group (Company/End Client Name + Complete Address), not a single free-text field", () => {
  const field = byKey(employer, "employer_workLocations");
  assert.ok(field, "employer_workLocations field is missing");
  assert.equal(field.type, "repeating_group");
  assert.equal(field.repeatable, true);
  assert.equal(field.required, true);
  const fieldKeys = field.metadata.repeatableFields.map((f) => f.key);
  assert.ok(fieldKeys.includes("companyName"), "expected a company/end-client name sub-field");
  assert.ok(fieldKeys.includes("street") && fieldKeys.includes("city") && fieldKeys.includes("state") && fieldKeys.includes("zipCode"), "expected a complete-address sub-field set");
});

test("End Client field preserves the source's verbatim 5-character legal-name note", () => {
  const field = byKey(employer, "employer_endClient_name");
  assert.ok(field, "employer_endClient_name field is missing");
  assert.match(field.label, /Legal Business Name of the secondary entity must contain at least 5 characters/);
});

test("Offered-salary frequency field is a required select matching the shared SALARY_UNITS list", () => {
  const { SALARY_UNITS } = require("../../employment-workflow/questionnaires/l1a");
  const field = byKey(employer, "employer_position_salaryUnit");
  assert.ok(field);
  assert.equal(field.required, true);
  assert.equal(field.type, "select");
  assert.deepEqual(field.options.map((o) => o.value), SALARY_UNITS.map((o) => (typeof o === "object" ? o.value : o)));
});

test("employee checklist has all 11 source beneficiary documents with the correct required flags", () => {
  const expected = {
    employee_i94_copy: true,
    passport: true,
    updated_resume: true,
    employee_ssn_copy: false,
    employee_drivers_license_or_state_id: false,
    academic_certificates: true,
    credential_evaluation_report: false,
    training_diploma_certificates: false,
    o1_awards_appraisals_certifications: true,
    previous_work_experience_letters: true,
    previous_i797_notices: false,
  };
  Object.entries(expected).forEach(([key, required]) => {
    const doc = byKey(employee, key);
    assert.ok(doc, `expected employee document "${key}"`);
    assert.equal(doc.type, "file");
    assert.equal(doc.required, required, `${key} required flag mismatch`);
  });
});

test("conditional logic: inside-US fields are visible only when insideUnitedStates=yes, outside-US fields only when =no", () => {
  const insideFields = [
    "employee_immigrationStatus_dateOfLastArrival",
    "employee_immigrationStatus_i94Number",
    "employee_immigrationStatus_currentVisaStatus",
    "employee_immigrationStatus_currentStatusExpirationDate",
  ];
  insideFields.forEach((key) => {
    const field = byKey(employee, key);
    assert.ok(field, `expected field "${key}"`);
    assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_immigrationStatus_insideUnitedStates: { value: "yes" } }), true);
    assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_immigrationStatus_insideUnitedStates: { value: "no" } }), false);
  });
  const outsideFields = [
    "employee_immigrationStatus_consulateForStamping",
    "employee_immigrationStatus_foreignResidentialAddress_street",
  ];
  outsideFields.forEach((key) => {
    const field = byKey(employee, key);
    assert.ok(field, `expected field "${key}"`);
    assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_immigrationStatus_insideUnitedStates: { value: "no" } }), true);
    assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_immigrationStatus_insideUnitedStates: { value: "yes" } }), false);
  });
});

test("conditional logic: 'If Yes, how many?' dependents count is required only when hasDependents=yes", () => {
  const field = byKey(employee, "employee_otherInformation_numberOfDependents");
  assert.ok(field);
  assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_otherInformation_hasDependents: { value: "yes" } }), true);
  assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_otherInformation_hasDependents: { value: "no" } }), false);
});

test("conditional logic: O-1 denial explanation is shown only when deniedO1VisaLastSevenYears=yes", () => {
  const field = byKey(employee, "employee_otherInformation_o1VisaDenialExplanation");
  assert.ok(field);
  assert.equal(field.type, "textarea");
  assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_otherInformation_deniedO1VisaLastSevenYears: { value: "yes" } }), true);
  assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_otherInformation_deniedO1VisaLastSevenYears: { value: "no" } }), false);
});

test("all 10 O-1A criteria groups are present and gated on employer_oClassification=O-1A, hidden for O-1B", () => {
  for (let number = 1; number <= 10; number += 1) {
    const criterionQuestions = employee.questions.filter((q) => q.metadata?.criterionNumber === number && !q.key.startsWith("o_1b_"));
    assert.ok(criterionQuestions.length > 0, `expected at least one question for O-1A criterion ${number}`);
    criterionQuestions.forEach((q) => {
      assert.equal(evaluateConditionGroup(q.conditionalLogic, { employer_oClassification: { value: "O-1A" } }), true, `${q.key} should be visible for O-1A`);
      assert.equal(evaluateConditionGroup(q.conditionalLogic, { employer_oClassification: { value: "O-1B" } }), false, `${q.key} should be hidden for O-1B`);
    });
  }
});

test("Criterion 8 has three lettered subsections (A: recommenders, B: proof of critical role, C: leadership evidence)", () => {
  const subsectionKeys = ["A", "B", "C"];
  subsectionKeys.forEach((letter) => {
    const has = employee.questions.some((q) => q.metadata?.criterionNumber === 8 && q.metadata?.subgroup === letter);
    assert.ok(has, `expected at least one question for Criterion 8${letter}`);
  });
});

test("Criterion 8A is a repeating group of up to 10 structured recommender profiles (name/title/organization/LinkedIn), not free text", () => {
  const field = employee.questions.find((q) => q.metadata?.criterionNumber === 8 && q.metadata?.subgroup === "A");
  assert.ok(field, "Criterion 8A question is missing");
  assert.equal(field.type, "repeating_group");
  assert.equal(field.repeatable, true);
  const fieldKeys = field.metadata.repeatableFields.map((f) => f.key);
  assert.deepEqual(fieldKeys.sort(), ["linkedinUrl", "name", "organization", "title"].sort());
});

test("Criterion 8B and 8C support multiple document uploads each (not capped at one file)", () => {
  const c8b = employee.questions.filter((q) => q.metadata?.criterionNumber === 8 && q.metadata?.subgroup === "B");
  const c8c = employee.questions.filter((q) => q.metadata?.criterionNumber === 8 && q.metadata?.subgroup === "C");
  assert.ok(c8b.length > 1, "expected multiple distinct upload questions for Criterion 8B");
  assert.ok(c8c.length > 1, "expected multiple distinct upload questions for Criterion 8C");
  [...c8b, ...c8c].forEach((q) => assert.equal(q.type, "file"));
});

test("optional ('if any'/'if you have') criteria (2, 7, 10) are not marked required", () => {
  [2, 7, 10].forEach((number) => {
    const questions = employee.questions.filter((q) => q.metadata?.criterionNumber === number && !q.key.startsWith("o_1b_"));
    questions.forEach((q) => assert.equal(q.required, false, `${q.key} (criterion ${number}) should stay optional`));
  });
});

test("every employee question's mapping.canonicalPath resolves in CanonicalFieldRegistryService", () => {
  const registryPaths = new Set(CanonicalFieldRegistryService.list().map((field) => field.path));
  const mappedQuestions = employee.questions.filter((question) => question.mapping?.canonicalPath);
  assert.ok(mappedQuestions.length > 0, "expected at least one employee question with a canonical mapping");
  mappedQuestions.forEach((question) => {
    assert.ok(
      registryPaths.has(question.mapping.canonicalPath),
      `question "${question.key}" maps to unregistered canonical path "${question.mapping.canonicalPath}"`
    );
  });
});

test("employer and employee checklists carry disjoint role-based visibility (employer never visible to the employee portal and vice versa)", () => {
  employer.questions.forEach((question) => {
    assert.ok(question.visibility.roles.includes("employer"), `${question.key} should be visible to employer`);
    assert.ok(!question.visibility.roles.includes("employee"), `${question.key} should not be visible to employee`);
    assert.ok(question.visibility.portals.includes("employer") && !question.visibility.portals.includes("employee"));
  });
  employee.questions.forEach((question) => {
    assert.ok(question.visibility.roles.includes("employee"), `${question.key} should be visible to employee`);
    assert.ok(!question.visibility.roles.includes("employer"), `${question.key} should not be visible to employer`);
    assert.ok(question.visibility.portals.includes("employee"), `${question.key} should be visible on the employee portal`);
    assert.ok(!question.visibility.portals.includes("employer"), `${question.key} should not be visible on the employer portal`);
  });
});

test("O1 checklists declare visaTypes covering both real O-1 case sub-codes (O-1A/O-1B, hyphenated and hyphen-stripped)", () => {
  const expected = ["O1", "O-1A", "O-1B", "O1A", "O1B"];
  for (const definition of [employer, employee]) {
    expected.forEach((code) => {
      assert.ok(definition.visaTypes?.includes(code), `${definition.key}.visaTypes is missing "${code}"`);
    });
  }
});
