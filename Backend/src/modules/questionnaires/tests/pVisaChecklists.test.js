const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const { evaluateConditionGroup } = require("../condition-evaluator");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");

// P Visa questionnaire coverage/fidelity tests, following the same DB-free
// convention as employmentChecklists.test.js: EMPLOYMENT_CHECKLIST_DEFINITIONS
// is a pure, deterministic computation over p.js's static exports, so no
// Mongoose is needed to test its shape. Live DB provisioning
// (ensureDefaultVisaTemplates against a real Questionnaire/Question
// collection) and the full employer+employee-same-case/role-visibility chain
// were verified live against the running dev backend.

const employer = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "p_employer_checklist");
const employee = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "p_employee_checklist");

function byKey(definition, key) {
  return definition.questions.find((question) => question.key === key);
}

test("p_employer_checklist and p_employee_checklist definitions exist and are registered", () => {
  assert.ok(employer, "p_employer_checklist definition is missing from EMPLOYMENT_CHECKLIST_DEFINITIONS");
  assert.ok(employee, "p_employee_checklist definition is missing from EMPLOYMENT_CHECKLIST_DEFINITIONS");
});

test("p_employer_checklist and p_employee_checklist have no duplicate question keys", () => {
  for (const definition of [employer, employee]) {
    const keys = definition.questions.map((question) => question.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${definition.key} has duplicate question keys: ${duplicates.join(", ")}`);
  }
});

test("neither P checklist definition sets a published status (stays in draft, matching every other built-in template)", () => {
  for (const definition of [employer, employee]) {
    assert.notEqual(definition.status, "published");
  }
});

test("both P checklists are tagged visaType P and carry the correct checklistRole", () => {
  assert.equal(employer.visaType, "P");
  assert.equal(employee.visaType, "P");
  assert.equal(employer.checklistRole, "employer");
  assert.equal(employee.checklistRole, "employee");
});

// Regression test for a real gap found via live-DB verification: a P case's
// visaType is stored as its actual sub-classification (P-1A/P-1B/P-3 — see
// config/visaCategories.js, which has no bare "P" entry), not the generic "P"
// tag the shared questionnaire itself carries. resolveCaseQuestionnaires/
// getQuestionnaireForCase match on this array (after stripping hyphens/spaces
// and uppercasing), so without every sub-code listed here, a real P-1A/P-1B/
// P-3 case would get a 404 "No questionnaire template found" instead of this
// checklist — confirmed by reproducing it against the live database before
// this fix.
test("both P checklists declare visaTypes covering every real P case sub-code (P-1A/P-1B/P-3, hyphenated and hyphen-stripped)", () => {
  const expected = ["P", "P-1A", "P-1B", "P-3", "P1A", "P1B", "P3"];
  for (const definition of [employer, employee]) {
    expected.forEach((code) => {
      assert.ok(definition.visaTypes?.includes(code), `${definition.key}.visaTypes is missing "${code}"`);
    });
  }
});

test("employer checklist has the source's 4 common employer documents (business license, articles of incorporation, letterhead, itinerary)", () => {
  const commonDocKeys = ["business_license", "articles_of_incorporation", "company_letterhead", "p_event_itinerary"];
  commonDocKeys.forEach((key) => {
    const doc = byKey(employer, key);
    assert.ok(doc, `expected common employer document "${key}"`);
    assert.equal(doc.type, "file");
    assert.equal(doc.required, true);
  });
});

test("employer checklist has the source's 6-item 'Evidence of International Recognition' (P-1A) document set", () => {
  const p1aKeys = [
    "p1a_us_league_contracts",
    "p1a_rankings_awards",
    "p1a_media_coverage",
    "p1a_expert_recommendation_letters",
    "p1a_significant_competitions_proof",
    "p1a_athlete_us_employer_contract",
  ];
  p1aKeys.forEach((key) => assert.ok(byKey(employer, key), `expected P-1A evidence document "${key}"`));
});

test("P-1B evidence document preserves the source's verbatim '75% of members ... at least 1 year' language", () => {
  const doc = byKey(employer, "p1b_sustained_recognition_evidence");
  assert.ok(doc, "p1b_sustained_recognition_evidence question is missing");
  assert.match(doc.label, /at least 75% of members must have been with the group for at least 1 year/);
});

test("P-3 evidence documents cover all 4 culturally-unique-program items from the source", () => {
  const p3Keys = ["p3_expert_opinions_testimonials", "p3_media_photos_video", "p3_cultural_history_explanation", "p3_expert_letters"];
  p3Keys.forEach((key) => assert.ok(byKey(employer, key), `expected P-3 evidence document "${key}"`));
});

test("P-1A/P-1B/P-3 evidence documents are each gated on employer_pClassification and invisible for the other two sub-types", () => {
  const groups = [
    { key: "p1a_us_league_contracts", value: "P-1A" },
    { key: "p1b_sustained_recognition_evidence", value: "P-1B" },
    { key: "p3_expert_letters", value: "P-3" },
  ];
  groups.forEach(({ key, value }) => {
    const doc = byKey(employer, key);
    assert.equal(evaluateConditionGroup(doc.conditionalLogic, { employer_pClassification: { value } }), true, `${key} should be visible for ${value}`);
    ["P-1A", "P-1B", "P-3"].filter((v) => v !== value).forEach((other) => {
      assert.equal(evaluateConditionGroup(doc.conditionalLogic, { employer_pClassification: { value: other } }), false, `${key} should be hidden for ${other}`);
    });
  });
});

test("employer_pClassification is a required select offering exactly P-1A/P-1B/P-3, mapped to the visaVariant master-data path", () => {
  const field = byKey(employer, "employer_pClassification");
  assert.ok(field);
  assert.equal(field.required, true);
  assert.equal(field.type, "select");
  assert.deepEqual(field.options.map((o) => o.value), ["P-1A", "P-1B", "P-3"]);
  assert.equal(field.metadata?.masterDataPath, "visaVariant");
});

test("End Client field preserves the source's verbatim 5-character legal-name note", () => {
  const field = byKey(employer, "employer_endClient_name");
  assert.ok(field, "employer_endClient_name field is missing");
  assert.match(field.label, /Legal Business Name of secondary entity must contain at least 5 characters/);
});

test("Offered-salary frequency field is a required select matching the shared SALARY_UNITS list", () => {
  const { SALARY_UNITS } = require("../../employment-workflow/questionnaires/l1a");
  const field = byKey(employer, "employer_position_salaryUnit");
  assert.ok(field);
  assert.equal(field.required, true);
  assert.equal(field.type, "select");
  assert.deepEqual(field.options.map((o) => o.value), SALARY_UNITS.map((o) => (typeof o === "object" ? o.value : o)));
});

test("employee checklist has the source's 6-item beneficiary document list with the correct required flags", () => {
  const expected = {
    previous_i797_notices: false,
    i20_f1_approval_notices: false,
    employee_i94_copy: true,
    passport: true,
    employee_ssn_copy: false,
    employee_drivers_license_or_state_id: false,
  };
  Object.entries(expected).forEach(([key, required]) => {
    const doc = byKey(employee, key);
    assert.ok(doc, `expected employee document "${key}"`);
    assert.equal(doc.type, "file");
    assert.equal(doc.required, required, `${key} required flag mismatch`);
  });
});

test("conditional logic: inside-US fields (arrival date, I-94#, current status, expiration) are visible only when insideUnitedStates=yes", () => {
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
});

test("conditional logic: outside-US fields (consulate, foreign address) are visible only when insideUnitedStates=no", () => {
  const outsideFields = [
    "employee_immigrationStatus_consulateForStamping",
    "employee_immigrationStatus_foreignResidentialAddress_street",
    "employee_immigrationStatus_foreignResidentialAddress_city",
    "employee_immigrationStatus_foreignResidentialAddress_state",
    "employee_immigrationStatus_foreignResidentialAddress_country",
    "employee_immigrationStatus_foreignResidentialAddress_zipCode",
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

test("conditional logic: P-visa denial explanation is shown only when deniedPVisaLastSevenYears=yes", () => {
  const field = byKey(employee, "employee_otherInformation_pVisaDenialExplanation");
  assert.ok(field);
  assert.equal(field.type, "textarea");
  assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_otherInformation_deniedPVisaLastSevenYears: { value: "yes" } }), true);
  assert.equal(evaluateConditionGroup(field.conditionalLogic, { employee_otherInformation_deniedPVisaLastSevenYears: { value: "no" } }), false);
});

test("all six Yes/No questions from 'Complete the following' are present (valid passport, replace I-94, dependents, removal proceedings, employer-filed green card, held/denied P visa)", () => {
  const yesNoKeys = [
    "employee_otherInformation_hasValidPassport",
    "employee_otherInformation_replaceI94",
    "employee_otherInformation_hasDependents",
    "employee_otherInformation_inRemovalProceedings",
    "employee_otherInformation_employerFiledGreenCard",
    "employee_otherInformation_heldPVisaLastSevenYears",
    "employee_otherInformation_deniedPVisaLastSevenYears",
  ];
  yesNoKeys.forEach((key) => assert.ok(byKey(employee, key), `expected Yes/No question "${key}"`));
});

test("employee's current U.S. address is split into structured street/apartment/city/state/zip fields (fitting the existing data model)", () => {
  ["street", "apartment", "city", "state", "zipCode"].forEach((part) => {
    assert.ok(byKey(employee, `employee_personal_currentUsAddress_${part}`), `expected structured address field for "${part}"`);
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
