// PERM Employer + Employee checklists: definitions, validation, conditional
// logic, repeating Employment History rows, and the case-type wiring.
// Pure tests - no database.
const test = require("node:test");
const assert = require("node:assert/strict");

const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const { evaluateConditionGroup } = require("../condition-evaluator");
const { validateRepeatingGroupRows } = require("../repeating-group-validation");
const service = require("../questionnaire.service");
const visaCategories = require("../../../config/visaCategories");
const KnowledgeEngine = require("../../cases/immigration-knowledge-engine.service");

const employer = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((d) => d.key === "perm_employer_information");
const employee = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((d) => d.key === "perm_employee_information");
const q = (definition, path) => definition.questions.find((question) => question.metadata?.sourcePath === path);
const byKey = (definition, key) => definition.questions.find((question) => question.key === key);

// ── registration / case type ───────────────────────────────────────────
test("PERM is an ordinary employer/employee case type: employees can be added, and it has no USCIS forms or mapping", () => {
  assert.equal(visaCategories.getCaseStructure("PERM"), "employer_employee");
  assert.deepEqual(visaCategories.getFormIds("PERM"), []);
  assert.equal(visaCategories.hasNoForms("PERM"), true, "PERM never has forms (the Forms list is always empty)");
  assert.equal(visaCategories.hasNoForms("H-1B"), false);
  assert.equal(visaCategories.isSingleEmployeeType, undefined, "the one-employee rule no longer exists");
  assert.equal(visaCategories.VISA_CATEGORIES.PERM.singleEmployee, undefined);
  const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
  assert.deepEqual(mappings.filter((row) => row.visaType === "PERM"), [], "no registry row (no form, no DOL/USCIS mapping) for PERM");
  const checklistSeed = require("../../form-registry/seeds/checklistMappings.seed");
  assert.deepEqual(checklistSeed.ENTRIES.filter((entry) => entry.visaType === "PERM"), []);
  assert.equal(visaCategories.getCaseStructure("EB-2 PERM"), "employer_employee"); // existing type untouched
});

test("both checklists are registered, auto-assigned (isDefault) to PERM with the right role", () => {
  assert.ok(employer && employee);
  assert.equal(employer.checklistRole, "employer");
  assert.equal(employee.checklistRole, "employee");
  [employer, employee].forEach((definition) => {
    assert.equal(definition.isDefault, true);
    assert.deepEqual(definition.visaTypes, ["PERM"]);
    assert.equal(definition.visaType, "PERM");
  });
  const keys = [...employer.questions, ...employee.questions].map((question) => question.key);
  assert.equal(new Set(keys).size, keys.length, "question keys are unique");
});

test("PERM checklists do not apply to other visa types (and existing EB-2 PERM is untouched)", () => {
  const forPerm = EMPLOYMENT_CHECKLIST_DEFINITIONS.filter((d) => (d.visaTypes || [d.visaType]).includes("PERM"));
  assert.deepEqual(forPerm.map((d) => d.key).sort(), ["perm_employee_information", "perm_employer_information"]);
  assert.ok(!EMPLOYMENT_CHECKLIST_DEFINITIONS.some((d) => d.key.startsWith("i140") && (d.visaTypes || []).includes("PERM")));
});

// ── employer checklist ─────────────────────────────────────────────────
const EMPLOYER_SPEC = [
  ["employer.company_name", true], ["employer.address", true], ["employer.county", true], ["employer.total_employees", true],
  ["employer.state_id_number", true], ["employer.ein", true], ["employer.business_phone", true], ["employer.fax", false],
  ["employer.contact_person_name", true], ["employer.contact_person_designation", true], ["employer.contact_person_phone", true],
  ["employer.contact_person_email", true], ["employer.website", false], ["employer.additional_phone", false],
  ["employer.is_federal_contractor", true], ["employer.is_ada_compliant", true], ["employer.union_status", true],
  ["employer.apprentice_registration_number", false], ["employer.company_profile", true],
];

test("employer checklist: the 19 specified questions with the specified required/optional flags, in order", () => {
  const sourcePaths = employer.questions.map((question) => question.metadata.sourcePath).filter((path) => path !== "employer.contact_person_phone_extension");
  assert.deepEqual(sourcePaths, EMPLOYER_SPEC.map(([path]) => path));
  EMPLOYER_SPEC.forEach(([path, required]) => assert.equal(q(employer, path).required, required, `${path} required=${required}`));
  assert.deepEqual(employer.sections, ["Employer Information"]);
});

test("employer: union status is a fixed two-option select, never free text", () => {
  const union = q(employer, "employer.union_status");
  assert.equal(union.type, "select");
  assert.deepEqual(union.options.map((option) => option.value), ["Union Shop", "Nonunion Shop"]);
  assert.equal(q(employer, "employer.is_federal_contractor").type, "radio");
  assert.equal(q(employer, "employer.is_ada_compliant").type, "radio");
});

test("employer: State ID is numeric text (8-9 digits, leading zeros kept); EIN accepts XX-XXXXXXX and is stored as digits", () => {
  const stateId = q(employer, "employer.state_id_number");
  assert.equal(stateId.type, "text"); // string, never an integer field
  const check = (question, value) => service.validateQuestionValue(question, value).errors;
  assert.deepEqual(check(stateId, "01234567"), []);
  assert.deepEqual(check(stateId, "012345678"), []);
  assert.equal(check(stateId, "1234567").length, 1); // 7 digits
  assert.equal(check(stateId, "1234567890").length, 1); // 10 digits
  assert.equal(check(stateId, "12AB5678").length, 1);
  assert.equal(service.normalizeAnswerValue(stateId, "01234567"), "01234567"); // leading zero preserved

  const ein = q(employer, "employer.ein");
  assert.deepEqual(check(ein, "12-3456789"), []);
  assert.deepEqual(check(ein, "123456789"), []);
  assert.equal(check(ein, "12-345678").length, 1);
  assert.equal(service.normalizeAnswerValue(ein, "12-3456789"), "123456789");
});

test("employer: optional fields (fax, website, extra phone) never fail a format rule just by being empty; bad websites do", () => {
  const website = q(employer, "employer.website");
  assert.deepEqual(service.validateQuestionValue(website, "").errors, []);
  assert.deepEqual(service.validateQuestionValue(website, undefined).errors, []);
  assert.deepEqual(service.validateQuestionValue(website, "https://www.acme.com/about").errors, []);
  assert.equal(service.validateQuestionValue(website, "not a website").errors.length, 1);
  assert.equal(service.validateQuestionValue(q(employer, "employer.total_employees"), 0).errors.length, 1);
  assert.deepEqual(service.validateQuestionValue(q(employer, "employer.total_employees"), 25).errors, []);
});

test("employer: only the company profile may be long/rich text", () => {
  assert.equal(q(employer, "employer.company_profile").type, "rich_text");
  assert.equal(q(employer, "employer.address").type, "address");
});

// ── employee checklist ─────────────────────────────────────────────────
const EMPLOYEE_SPEC = [
  ["employee.first_name", true], ["employee.middle_name", false], ["employee.last_name", true], ["employee.address", true],
  ["employee.city", true], ["employee.state", true], ["employee.country", true], ["employee.zip_code", true], ["employee.phone", true],
  ["employee.citizenship_country", true], ["employee.birth_country", true], ["employee.date_of_birth", true],
  ["employee.current_us_status", true], ["employee.alien_registration_number", false], ["employee.i94_number", false],
  ["employee.highest_education", true], ["employee.major_field", true], ["employee.education_completion_year", true],
  ["employee.education_institution_name", true], ["employee.education_institution_address", true], ["employee.education_institution_city", true],
  ["employee.education_institution_state", true], ["employee.education_institution_country", true], ["employee.education_institution_zip", true],
];

test("employee checklist: the 24 specified questions in order with the right required flags and section", () => {
  const section = employee.questions.filter((question) => question.sectionKey === "employee_information");
  assert.deepEqual(section.map((question) => question.metadata.sourcePath), EMPLOYEE_SPEC.map(([path]) => path));
  // institution state/zip are the two "conditional" ones; everything else matches the spec exactly
  EMPLOYEE_SPEC.filter(([path]) => !/institution_(state|zip)$/.test(path)).forEach(([path, required]) => assert.equal(q(employee, path).required, required, path));
  assert.deepEqual(employee.sections, ["Employee Information", "Employee Qualification", "Employment History", "Required Documents"]);
});

test("employee: field types follow the spec (state/country selects, date, status select, year)", () => {
  assert.equal(q(employee, "employee.state").type, "select");
  assert.equal(q(employee, "employee.state").options.length >= 51, true);
  assert.ok(q(employee, "employee.state").options.some((option) => option.value === "NY"));
  assert.equal(q(employee, "employee.country").type, "select");
  assert.ok(q(employee, "employee.country").options.some((option) => option.value === "United States"));
  assert.equal(q(employee, "employee.date_of_birth").type, "date");
  assert.equal(q(employee, "employee.current_us_status").type, "select");
  assert.ok(q(employee, "employee.current_us_status").options.some((option) => option.value === "H-1B"));
  assert.equal(q(employee, "employee.highest_education").type, "select");
  assert.equal(q(employee, "employee.phone").type, "phone");
  const year = q(employee, "employee.education_completion_year");
  assert.deepEqual(service.validateQuestionValue(year, "2016").errors, []);
  assert.equal(service.validateQuestionValue(year, "16").errors.length, 1);
  assert.deepEqual(service.validateQuestionValue(q(employee, "employee.i94_number"), "").errors, []); // optional
  assert.equal(service.validateQuestionValue(q(employee, "employee.i94_number"), "1234567890").errors.length, 1); // needs all 11
  assert.deepEqual(service.validateQuestionValue(q(employee, "employee.i94_number"), "12345678901").errors, []);
});

test("institution State/ZIP apply only to U.S. institutions - a foreign institution is never forced to give them", () => {
  const state = q(employee, "employee.education_institution_state");
  const zip = q(employee, "employee.education_institution_zip");
  const visible = (question, country) => service.isQuestionVisible(question, { employee_education_institution_country: country }, { role: "employee" });
  assert.equal(visible(state, "United States"), true);
  assert.equal(visible(zip, "United States"), true);
  assert.equal(visible(state, "India"), false);
  assert.equal(visible(zip, "India"), false);
  const answers = { employee_education_institution_country: "India" };
  const validation = service.validateResponse({ _id: "q", key: "k", version: 1 }, [state, zip], answers, { role: "employee" });
  assert.deepEqual(validation.missingRequired, []);
});

// ── qualification ──────────────────────────────────────────────────────
test("qualification: three Yes/No questions; duration (Years/Months) appears only after 'Yes'", () => {
  const qualification = employee.questions.filter((question) => question.sectionKey === "employee_qualification");
  const yesNo = qualification.filter((question) => question.type === "radio").map((question) => question.metadata.sourcePath);
  assert.deepEqual(yesNo, ["employee.qualifying_experience_with_petitioner", "employee.employer_paid_education_training", "employee.currently_employed_by_petitioner"]);
  qualification.filter((question) => question.type === "radio").forEach((question) => assert.equal(question.required, true));
  const years = q(employee, "employee.qualifying_experience_years");
  const months = q(employee, "employee.qualifying_experience_months");
  assert.equal(years.type, "number");
  assert.equal(months.type, "number");
  const show = (question, value) => service.isQuestionVisible(question, { employee_qualifying_experience_with_petitioner: value }, { role: "employee" });
  assert.equal(show(years, "Yes"), true);
  assert.equal(show(years, "No"), false);
  assert.equal(show(years, undefined), false);
  assert.equal(show(months, "Yes"), true);
  assert.equal(service.validateQuestionValue(years, -1).errors.length, 1);
  assert.equal(service.validateQuestionValue(months, 12).errors.length, 1);
});

// ── employment history ────────────────────────────────────────────────
const history = byKey(employee, "employee_employment_history");
const completeJob = (overrides = {}) => ({
  company_name: "ABC Technologies", address: "1 Main St", city: "Austin", state: "TX", country: "United States", zip_code: "73301",
  supervisor_name: "Jane Roe", supervisor_phone: "512-555-0100", business_type: "Software", job_title: "Software Engineer",
  start_date: "2021-10-01", end_date: "2023-12-20", hours_per_week: 40, job_details: "Built services.", skills_tools: "Node.js, React", ...overrides,
});

test("employment history is a repeating group, required (at least one job), with no maximum", () => {
  assert.equal(history.type, "repeating_group");
  assert.equal(history.repeatable, true);
  assert.equal(history.required, true);
  assert.equal(history.repeatableConfig.min, 1);
  assert.equal(history.repeatableConfig.max, undefined, "no artificial two-job limit");
  assert.equal(history.repeatableConfig.labelTemplate, "Job {n}");
  assert.equal(history.metadata.addLabel, "+ Add Employment");
  assert.equal(history.metadata.itemLabel, "Job");
  assert.equal(history.mapping.canonicalPath, "perm.employmentHistory");
});

test("employment history carries the two source instructions verbatim", () => {
  assert.deepEqual(history.metadata.instructions, [
    "List all jobs you have held during the past 5 years. Also list any other experience that qualifies you for the job opportunity for which the employer is seeking PERM Certification.",
    "Only provide information about the company that was your direct employer. Client information where you worked as a consultant is not needed.",
  ]);
});

test("every employment-history column from the spec exists with the right type; end date is conditional", () => {
  const columns = Object.fromEntries(history.metadata.fields.map((column) => [column.key, column]));
  const expected = {
    company_name: "text", address: "text", city: "text", state: "combo", country: "select", zip_code: "text", supervisor_name: "text",
    supervisor_phone: "phone", business_type: "text", job_title: "text", start_date: "date", end_date: "date", hours_per_week: "number",
    job_details: "textarea", skills_tools: "textarea",
  };
  Object.entries(expected).forEach(([key, type]) => assert.equal(columns[key]?.type, type, key));
  Object.keys(expected).filter((key) => key !== "end_date").forEach((key) => assert.equal(columns[key].required, true, `${key} is required`));
  assert.deepEqual(columns.end_date.requiredUnless, { field: "is_current", equals: true });
  assert.equal(columns.is_current.type, "checkbox");
  assert.deepEqual(history.metadata.repeatableFields, history.metadata.fields, "admin panel reads repeatableFields; client reads fields");
});

test("a complete job is valid; any number of jobs is accepted", () => {
  const many = Array.from({ length: 12 }, (_, index) => completeJob({ start_date: `20${23 - index}-01-01`, end_date: `20${23 - index}-12-31` }));
  const result = validateRepeatingGroupRows(history, many);
  assert.deepEqual(result.errors, []);
});

test("required job fields are enforced per job, and messages name the job", () => {
  const result = validateRepeatingGroupRows(history, [completeJob(), completeJob({ company_name: "", job_title: " ", supervisor_phone: "" })]);
  assert.ok(result.errors.some((message) => message.startsWith("Job 2:") && /Company's Name/.test(message)));
  assert.ok(result.errors.some((message) => message.startsWith("Job 2:") && /Job Title/.test(message)));
  assert.ok(result.errors.some((message) => message.startsWith("Job 2:") && /Phone Number of Supervisor/.test(message)));
  assert.ok(!result.errors.some((message) => message.startsWith("Job 1:")));
});

test("current employment needs no end date (End Date = Present); a finished job does", () => {
  const present = validateRepeatingGroupRows(history, [completeJob({ is_current: true, end_date: "" })]);
  assert.deepEqual(present.errors, []);
  const finishedWithoutEnd = validateRepeatingGroupRows(history, [completeJob({ is_current: false, end_date: "" })]);
  assert.ok(finishedWithoutEnd.errors.some((message) => /End Date is required/.test(message)));
});

test("start date cannot be after end date (unless the job is current)", () => {
  const bad = validateRepeatingGroupRows(history, [completeJob({ start_date: "2024-05-01", end_date: "2023-01-01" })]);
  assert.ok(bad.errors.some((message) => /Start date cannot be after End date/.test(message)));
  const sameDay = validateRepeatingGroupRows(history, [completeJob({ start_date: "2023-01-01", end_date: "2023-01-01" })]);
  assert.deepEqual(sameDay.errors, []);
  const current = validateRepeatingGroupRows(history, [completeJob({ start_date: "2024-05-01", end_date: "2023-01-01", is_current: true })]);
  assert.deepEqual(current.errors, []);
});

test("hours per week must be a sensible number", () => {
  const run = (value) => validateRepeatingGroupRows(history, [completeJob({ hours_per_week: value })]).errors;
  assert.deepEqual(run(40), []);
  assert.deepEqual(run("37.5"), []);
  assert.equal(run(-5).length, 1);
  assert.equal(run(0).length, 1);
  assert.equal(run(200).length, 1);
  assert.equal(run("abc").length, 1);
});

test("jobs are listed most-recent first: out-of-order is only a warning, never blocks saving", () => {
  const older = completeJob({ start_date: "2018-01-01", end_date: "2019-01-01" });
  const newer = completeJob({ start_date: "2021-01-01", end_date: "2023-01-01" });
  assert.deepEqual(validateRepeatingGroupRows(history, [newer, older]).warnings, []);
  const wrongOrder = validateRepeatingGroupRows(history, [older, newer]);
  assert.equal(wrongOrder.errors.length, 0);
  assert.equal(wrongOrder.warnings.length, 1);
});

test("validateQuestionValue runs the row checks for the repeating group; an empty history is no longer an error (nothing is mandatory to save)", () => {
  const withBadRow = service.validateQuestionValue(history, [completeJob({ company_name: "" })]);
  assert.ok(withBadRow.errors.some((message) => /Job 1: Company's Name/.test(message)));
  assert.deepEqual(service.validateQuestionValue(history, []).errors, []);
  assert.deepEqual(service.validateQuestionValue(history, [completeJob()]).errors, []);
});

// ── documents ──────────────────────────────────────────────────────────
test("documents: the four always-required employee documents are file questions in their own section", () => {
  const docs = employee.questions.filter((question) => question.sectionKey === "required_documents");
  assert.deepEqual(docs.map((question) => question.key), ["perm_resume", "perm_degree_documents", "perm_transcripts", "perm_experience_letters", "perm_degree_evaluation"]);
  docs.forEach((doc) => { assert.equal(doc.type, "file"); assert.equal(doc.required, true); });
  const always = docs.filter((doc) => doc.key !== "perm_degree_evaluation");
  always.forEach((doc) => assert.deepEqual(doc.conditionalLogic.rules, []));
  assert.match(docs[0].description, /clear, complete, valid copies/);
});

test("degree evaluation is required only when education was completed outside the United States", () => {
  const evaluation = byKey(employee, "perm_degree_evaluation");
  const visibleFor = (country) => service.isQuestionVisible(evaluation, { employee_education_institution_country: country }, { role: "employee" });
  assert.equal(visibleFor("India"), true);
  assert.equal(visibleFor("United Kingdom"), true);
  assert.equal(visibleFor("United States"), false); // US education: not asked
  assert.equal(visibleFor(undefined), false); // not asked until the country is known
  assert.equal(visibleFor(""), false);
  // not required (and so never "missing") when hidden
  const us = service.validateResponse({ _id: "q", key: "k", version: 1 }, [evaluation], { employee_education_institution_country: "United States" }, { role: "employee" });
  assert.deepEqual(us.missingRequired, []);
  const foreign = service.validateResponse({ _id: "q", key: "k", version: 1 }, [evaluation], { employee_education_institution_country: "India" }, { role: "employee" });
  assert.equal(foreign.missingRequired.length, 1);
  assert.equal(evaluation.metadata.questionnaireOnly, true);
});

test("conditional documents live in the questionnaire only - never added to the case as an unconditional checklist item", () => {
  const caseData = { documentChecklist: [] };
  KnowledgeEngine.mergeChecklist(caseData, [
    { name: "Latest Resume", documentType: "perm_resume", required: true, category: "employment", role: "employee" },
    { name: "Degree evaluation", documentType: "perm_degree_evaluation", required: true, category: "education", role: "employee", questionnaireOnly: true },
  ]);
  assert.deepEqual(caseData.documentChecklist.map((item) => item.documentType), ["perm_resume"]);
});

// ── canonical mapping ──────────────────────────────────────────────────
test("existing canonical fields are reused (no duplicate canonical fields invented)", () => {
  const mapped = (path) => q(employee, path).mapping?.canonicalPath;
  assert.equal(mapped("employee.first_name"), "person.firstName");
  assert.equal(mapped("employee.middle_name"), "person.middleName");
  assert.equal(mapped("employee.last_name"), "person.lastName");
  assert.equal(mapped("employee.date_of_birth"), "person.dob");
  assert.equal(mapped("employee.phone"), "contact.phone");
  assert.equal(mapped("employee.citizenship_country"), "person.citizenship");
  assert.equal(mapped("employee.birth_country"), "person.countryOfBirth");
  assert.equal(mapped("employee.current_us_status"), "immigration.currentStatus");
  assert.equal(mapped("employee.alien_registration_number"), "person.alienNumber");
  assert.equal(mapped("employee.i94_number"), "immigration.i94.number");
  assert.equal(mapped("employee.highest_education"), "education.0.degree");
  assert.equal(mapped("employee.education_institution_name"), "education.0.institution");
  assert.equal(mapped("employee.zip_code"), "contact.address.zip");
  const emp = (path) => q(employer, path).mapping?.canonicalPath;
  assert.equal(emp("employer.company_name"), "company.name");
  assert.equal(emp("employer.ein"), "company.ein");
  assert.equal(emp("employer.contact_person_email"), "company.contact.email");
  // PERM-only facts have no profile home, so they live under the dedicated perm.* canonical namespace
  // (employer-side facts under company.*, education extras under education.0.*) - never a USCIS-form field.
  assert.equal(q(employer, "employer.union_status").mapping.canonicalPath, "company.unionStatus");
  assert.equal(q(employer, "employer.address").mapping.canonicalPath, "company.address");
  assert.equal(q(employee, "employee.employer_paid_education_training").mapping.canonicalPath, "perm.employerPaidEducationTraining");
  assert.equal(q(employee, "employee.qualifying_experience_with_petitioner").mapping.canonicalPath, "perm.qualifyingExperienceWithPetitioner");
  assert.equal(q(employee, "employee.qualifying_experience_years").mapping.canonicalPath, "perm.qualifyingExperienceYears");
  assert.equal(q(employee, "employee.currently_employed_by_petitioner").mapping.canonicalPath, "perm.currentlyEmployedByPetitioner");
  assert.equal(q(employee, "employee.education_institution_zip").mapping.canonicalPath, "education.0.institutionZip");
});

test("employer and employee data stay separate: employer questions never use employee.* keys and vice versa", () => {
  assert.ok(employer.questions.every((question) => question.metadata.sourcePath.startsWith("employer.")));
  assert.ok(employee.questions.filter((question) => question.type !== "file").every((question) => question.metadata.sourcePath.startsWith("employee.")));
  assert.deepEqual(employer.questions[0].visibility.roles.slice(0, 1), ["employer"]);
  assert.deepEqual(employee.questions[0].visibility.roles.slice(0, 1), ["employee"]);
});

test("source wording is preserved for the questions", () => {
  assert.equal(q(employer, "employer.company_name").label, "Full Name of the Employer (company)");
  assert.equal(q(employer, "employer.union_status").label, "Special characteristics that applies to your company - Union shop or nonunion shop");
  assert.equal(q(employee, "employee.qualifying_experience_with_petitioner").label.startsWith("Did you gain any of the qualifying experience with the employer"), true);
  assert.equal(q(employee, "employee.alien_registration_number").label, "Alien Registration Number (A#, if available)");
  assert.equal(q(employee, "employee.i94_number").label, "Latest I-94 Number (put all 11 digits)");
});

test("evaluateConditionGroup sanity for the not_empty + not_equals combination used by the degree evaluation", () => {
  const group = byKey(employee, "perm_degree_evaluation").conditionalLogic;
  assert.equal(evaluateConditionGroup(group, { employee_education_institution_country: "Canada" }), true);
  assert.equal(evaluateConditionGroup(group, { employee_education_institution_country: "United States" }), false);
  assert.equal(evaluateConditionGroup(group, {}), false);
});
