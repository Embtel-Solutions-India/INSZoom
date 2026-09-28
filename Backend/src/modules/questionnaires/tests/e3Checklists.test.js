const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const e3 = require("../../employment-workflow/questionnaires/e3");

// DB-free tests, following e2Checklists.test.js's own established convention
// — EMPLOYMENT_CHECKLIST_DEFINITIONS is a pure, deterministic computation
// over e3.js's static exports, no Mongoose needed.

const e3Employer = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "e3_employer_checklist");
const e3Employee = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "e3_employee_checklist");

function byKey(definition, key) {
  return definition.questions.find((question) => question.key === key);
}

test("E-3 has exactly two independent checklist records (employer + beneficiary), never combined", () => {
  assert.ok(e3Employer, "e3_employer_checklist must exist");
  assert.ok(e3Employee, "e3_employee_checklist must exist");
  assert.notEqual(e3Employer.key, e3Employee.key);
});

test("both E-3 checklists share visaType E3 (employer_employee case architecture)", () => {
  assert.equal(e3Employer.visaType, "E3");
  assert.equal(e3Employee.visaType, "E3");
});

test("each E-3 checklist has the correct checklistRole", () => {
  assert.equal(e3Employer.checklistRole, "employer");
  assert.equal(e3Employee.checklistRole, "employee");
});

test("no duplicate question keys within either checklist", () => {
  [e3Employer, e3Employee].forEach((definition) => {
    const keys = definition.questions.map((q) => q.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${definition.key} has duplicate question keys: ${duplicates.join(", ")}`);
  });
});

test("no H-1B/L-1/O-1/P question keys leak into either E-3 checklist", () => {
  const foreignPrefixes = ["h1b_", "l1a_", "o1_", "p_", "eb1b_"];
  [e3Employer, e3Employee].forEach((definition) => {
    definition.questions.forEach((q) => {
      foreignPrefixes.forEach((prefix) => {
        assert.ok(!q.key.startsWith(prefix), `${definition.key}: question ${q.key} looks like it leaked from another visa's checklist`);
      });
    });
  });
});

// ── DOL/LCA verification conditional chain ─────────────────────────────────
test("DOL verification: dolVerified is conditional on firstLcaFiling=yes", () => {
  const dolVerified = byKey(e3Employer, "employer_lca_dolVerified");
  assert.ok(dolVerified);
  assert.equal(dolVerified.type, "radio");
  assert.deepEqual(dolVerified.conditionalLogic.rules, [{ questionKey: "employer_lca_firstLcaFiling", operator: "equals", value: "yes" }]);
});

test("DOL verification: FEIN proof document is conditional on firstLcaFiling=yes AND dolVerified=no, and reuses the existing IRS FEIN documentType", () => {
  const feinProof = byKey(e3Employer, "irs_fein_assignment_letter");
  assert.ok(feinProof, "FEIN proof document question must exist");
  assert.equal(feinProof.type, "file");
  assert.deepEqual(
    feinProof.conditionalLogic.rules,
    [
      { questionKey: "employer_lca_firstLcaFiling", operator: "equals", value: "yes" },
      { questionKey: "employer_lca_dolVerified", operator: "equals", value: "no" },
    ]
  );
});

test("the FEIN proof document is a document question, not a plain instruction", () => {
  const feinProof = byKey(e3Employer, "irs_fein_assignment_letter");
  assert.equal(feinProof.type, "file");
});

// ── Employer Part 2 / Part 3 fields ────────────────────────────────────────
test("employer company/signing-person/position fields exist with the expected types", () => {
  assert.equal(byKey(e3Employer, "employer_company_fullName").required, true);
  assert.equal(byKey(e3Employer, "employer_company_fein").required, true);
  assert.equal(byKey(e3Employer, "employer_company_yearEstablished").type, "number");
  assert.equal(byKey(e3Employer, "employer_signingPerson_email").type, "email");
  assert.equal(byKey(e3Employer, "employer_position_jobTitle").required, true);
  assert.equal(byKey(e3Employer, "employer_position_offeredSalary").type, "currency");
  assert.equal(byKey(e3Employer, "employer_endClient_name").required, true);
  assert.equal(byKey(e3Employer, "employer_position_employmentStartDate").type, "date");
  assert.equal(byKey(e3Employer, "employer_jobDescription_duties").type, "textarea");
  assert.equal(byKey(e3Employer, "employer_workforce_totalUsEmployees").type, "number");
});

test("employer work locations are a repeatable multi-value field, not a single address", () => {
  const workLocations = byKey(e3Employer, "employer_workLocations");
  assert.ok(workLocations, "employer_workLocations must exist");
  assert.equal(workLocations.repeatable, true);
  assert.equal(workLocations.type, "repeating_group");
});

test("Part 3 financial fields use currency/url types, not new question types", () => {
  assert.equal(byKey(e3Employer, "employer_company_website").type, "url");
  assert.equal(byKey(e3Employer, "employer_company_netIncome").type, "currency");
  assert.equal(byKey(e3Employer, "employer_company_grossAnnualIncome").type, "currency");
});

// ── Employer documents ──────────────────────────────────────────────────────
test("employer document checklist has exactly the 3 static Part-3 documents plus the conditional FEIN proof", () => {
  const documentQuestions = e3Employer.questions.filter((q) => q.type === "file");
  const documentTypes = documentQuestions.map((q) => q.metadata.documentType).sort();
  assert.deepEqual(documentTypes, ["articles_of_incorporation", "business_license", "company_letterhead", "irs_fein_assignment_letter"].sort());
});

test("employer documents reuse H-1B's existing document types rather than duplicating them", () => {
  const documentTypes = e3.employerDocuments.map((d) => d.documentType);
  assert.deepEqual(documentTypes, ["business_license", "articles_of_incorporation", "company_letterhead"]);
});

// ── Beneficiary personal / passport / US-presence fields ───────────────────
test("beneficiary personal information fields exist with correct required/optional status", () => {
  assert.equal(byKey(e3Employee, "employee_personal_lastName").required, true);
  assert.equal(byKey(e3Employee, "employee_personal_firstName").required, true);
  assert.equal(byKey(e3Employee, "employee_personal_middleName").required, false);
  assert.equal(byKey(e3Employee, "employee_personal_otherNamesUsed").required, false);
  assert.equal(byKey(e3Employee, "employee_personal_socialSecurityNumber").required, false, "SSN must stay optional (if available)");
  assert.equal(byKey(e3Employee, "employee_personal_alienRegistrationNumber").required, false, "A# must stay optional (if available)");
  assert.equal(byKey(e3Employee, "employee_personal_sevisNumber").required, false, "SEVIS number must stay optional (if available)");
});

test("passport fields belong to the beneficiary's personal section and are required", () => {
  assert.equal(byKey(e3Employee, "employee_personal_passportNumber").required, true);
  assert.equal(byKey(e3Employee, "employee_personal_passportIssueDate").required, true);
  assert.equal(byKey(e3Employee, "employee_personal_passportExpirationDate").required, true);
});

test("U.S. presence section is fully conditional on insideUnitedStates=yes", () => {
  const conditionalFields = [
    "employee_immigrationStatus_dateOfLastArrival",
    "employee_immigrationStatus_i94Number",
    "employee_immigrationStatus_currentVisaStatus",
    "employee_immigrationStatus_currentStatusExpirationDate",
  ];
  conditionalFields.forEach((key) => {
    const question = byKey(e3Employee, key);
    assert.ok(question, `${key} must exist`);
    assert.deepEqual(question.conditionalLogic.rules, [{ questionKey: "employee_immigrationStatus_insideUnitedStates", operator: "equals", value: "yes" }]);
    assert.equal(question.required, false, `${key} must not be unconditionally required`);
  });
});

// ── Other Information / eligibility questions (Q1-Q7) ──────────────────────
test("dependents: numberOfDependents is conditional on hasDependents=yes", () => {
  const hasDependents = byKey(e3Employee, "employee_immigrationHistory_hasDependents");
  const numberOfDependents = byKey(e3Employee, "employee_immigrationHistory_numberOfDependents");
  assert.ok(hasDependents);
  assert.equal(numberOfDependents.type, "number");
  assert.deepEqual(numberOfDependents.conditionalLogic.rules, [{ questionKey: "employee_immigrationHistory_hasDependents", operator: "equals", value: "yes" }]);
});

test("E-3 denial explanation only shows when deniedE3LastSevenYears=yes", () => {
  const denied = byKey(e3Employee, "employee_immigrationHistory_deniedE3LastSevenYears");
  const explanation = byKey(e3Employee, "employee_immigrationHistory_e3DenialExplanation");
  assert.ok(denied);
  assert.equal(explanation.type, "textarea");
  assert.deepEqual(explanation.conditionalLogic.rules, [{ questionKey: "employee_immigrationHistory_deniedE3LastSevenYears", operator: "equals", value: "yes" }]);
});

test("removal-proceedings explanation only shows when inRemovalProceedings=yes", () => {
  const explanation = byKey(e3Employee, "employee_immigrationHistory_removalProceedingsExplanation");
  assert.equal(explanation.type, "textarea");
  assert.deepEqual(explanation.conditionalLogic.rules, [{ questionKey: "employee_immigrationHistory_inRemovalProceedings", operator: "equals", value: "yes" }]);
});

test("all 7 'Other Information' eligibility questions exist", () => {
  [
    "employee_immigrationHistory_hasValidPassport",
    "employee_immigrationStatus_replaceI94",
    "employee_immigrationHistory_hasDependents",
    "employee_immigrationHistory_inRemovalProceedings",
    "employee_immigrationHistory_employerFiledGreenCard",
    "employee_immigrationHistory_heldE3LastSevenYears",
    "employee_immigrationHistory_deniedE3LastSevenYears",
  ].forEach((key) => assert.ok(byKey(e3Employee, key), `${key} must exist`));
});

// ── Beneficiary documents ───────────────────────────────────────────────────
test("beneficiary document checklist has all 15 documents (14 static + 1 conditional I-20/F-1)", () => {
  const documentQuestions = e3Employee.questions.filter((q) => q.type === "file");
  assert.equal(documentQuestions.length, 15);
});

test("beneficiary documents reuse existing global document types (w2, passport, etc.) rather than duplicating them", () => {
  const reusedTypes = ["academic_certificates", "credential_evaluation_report", "training_diploma_certificates", "updated_resume", "previous_work_experience_letters", "previous_i797_notices", "employee_i94_copy", "passport", "employee_ssn_copy", "employee_drivers_license_or_state_id", "w2", "last_3_months_pay_slips"];
  const actualTypes = e3.employeeDocuments.map((d) => d.documentType);
  reusedTypes.forEach((type) => assert.ok(actualTypes.includes(type), `expected reused documentType "${type}" in e3 employeeDocuments`));
});

test("the Australian-citizenship-or-birth-certificate document is a genuinely new, non-duplicate type", () => {
  const doc = e3.employeeDocuments.find((d) => d.documentType === "australian_citizenship_or_birth_certificate");
  assert.ok(doc);
  assert.equal(doc.required, true);
});

test("I-20/F-1 approval notices is conditional on currentVisaStatus in [F-1, OPT, STEM OPT], same mechanism as H-1B's", () => {
  const question = byKey(e3Employee, "f1_opt_stem_documents");
  assert.ok(question);
  assert.equal(question.conditionalLogic.mode, "any");
  assert.deepEqual(
    question.conditionalLogic.rules.map((r) => r.value).sort(),
    ["F-1", "OPT", "STEM OPT"].sort()
  );
});

// ── Canonical mapping ────────────────────────────────────────────────────────
test("beneficiary personal/passport/immigration-status fields carry a canonical mapping (reused from EMPLOYEE_CANONICAL_PATHS)", () => {
  const mappedKeys = [
    "employee_personal_firstName",
    "employee_personal_lastName",
    "employee_personal_dateOfBirth",
    "employee_personal_countryOfCitizenship",
    "employee_personal_passportNumber",
    "employee_immigrationStatus_currentVisaStatus",
    "employee_immigrationStatus_i94Number",
  ];
  mappedKeys.forEach((key) => {
    const question = byKey(e3Employee, key);
    assert.ok(question.mapping?.canonicalPath, `${key} must carry a canonical mapping`);
  });
});

test("employer-side fields carry no canonical mapping (employer/company canonical data is a distinct concern)", () => {
  e3Employer.questions.forEach((q) => {
    assert.ok(!q.mapping, `${q.key} must not carry a canonical mapping`);
  });
});
